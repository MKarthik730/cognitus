"""Data Enrichment Pipeline.

Extracts entities from case documents, fetches web context via Tavily,
and queries domain-specific APIs (PubMed, CourtListener, SEC EDGAR, NVD CVE).

Status steps are yielded for frontend UI display.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator

import httpx

from app.core.config import settings
from app.services.llm_router import get_llm_router

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Entity extraction
# ---------------------------------------------------------------------------

ENTITY_EXTRACTION_PROMPT = """\
You are an entity extraction specialist. Analyze the following document and extract all
entities into the JSON schema below.

Return ONLY valid JSON with these fields:
{
    "people": ["<full name>", ...],
    "organizations": ["<name>", ...],
    "drugs": ["<name>", ...],
    "locations": ["<location>", ...],
    "dates": ["<date>", ...],
    "legal_refs": ["<statute/case citation>", ...]
}

If a category has no entities, use an empty list [].
"""


async def extract_entities(document_text: str) -> dict[str, list[str]]:
    """Extract structured entities from document text using LLM."""
    router = get_llm_router()
    try:
        response, _ = await router.generate(
            ENTITY_EXTRACTION_PROMPT,
            f"Document: {document_text[:6000]}",
            max_tokens=512,
        )
        from app.schemas.node_output import clean_json_response
        cleaned = clean_json_response(response)
        data = json.loads(cleaned)
        return {
            "people": data.get("people", []),
            "organizations": data.get("organizations", []),
            "drugs": data.get("drugs", []),
            "locations": data.get("locations", []),
            "dates": data.get("dates", []),
            "legal_refs": data.get("legal_refs", []),
        }
    except Exception as e:
        logger.warning("Entity extraction failed: %s", e)
        return {
            "people": [], "organizations": [], "drugs": [],
            "locations": [], "dates": [], "legal_refs": [],
        }


# ---------------------------------------------------------------------------
# Web search enrichment (Tavily)
# ---------------------------------------------------------------------------

TAVILY_API_URL = "https://api.tavily.com/search"


async def web_search_enrichment(
    entities: dict[str, list[str]],
    question: str,
    max_results: int = 3,
) -> list[dict[str, Any]]:
    """Search the web for top entities and question using Tavily API."""
    api_key = settings.TAVILY_API_KEY or ""
    if not api_key:
        logger.info("TAVILY_API_KEY not configured, skipping web search enrichment")
        return []

    # Build search queries from top entities + question
    all_entities = []
    for category_list in entities.values():
        all_entities.extend(category_list[:3])  # Top 3 per category

    queries = [question]
    for entity in all_entities[:5]:  # Top 5 entities
        queries.append(f"{entity} {question}")

    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for query in queries[:3]:  # Max 3 queries
            try:
                response = await client.post(
                    TAVILY_API_URL,
                    json={
                        "api_key": api_key,
                        "query": query,
                        "search_depth": "basic",
                        "max_results": max_results,
                    },
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code == 200:
                    data = response.json()
                    for r in data.get("results", []):
                        results.append({
                            "query": query,
                            "title": r.get("title", ""),
                            "url": r.get("url", ""),
                            "content": r.get("content", "")[:500],
                        })
            except Exception as e:
                logger.warning("Tavily search failed for '%s': %s", query, e)

    return results[:9]  # Limit total


# ---------------------------------------------------------------------------
# Domain API enrichment (template-aware)
# ---------------------------------------------------------------------------

PUBMED_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
COURTLISTENER_BASE = "https://www.courtlistener.com/api/rest/v3"
SEC_EDGAR_BASE = "https://data.sec.gov/submissions"
NVD_CVE_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0"


async def enrich_medical(entities: dict[str, list[str]]) -> list[dict[str, Any]]:
    """Query PubMed E-utilities for medical context."""
    results: list[dict[str, Any]] = []
    search_terms = entities.get("drugs", [])[:3] + entities.get("organizations", [])[:2]
    async with httpx.AsyncClient(timeout=10.0) as client:
        for term in search_terms:
            try:
                resp = await client.get(
                    f"{PUBMED_EUTILS_BASE}/esearch.fcgi",
                    params={"db": "pubmed", "term": term, "retmax": 3, "retmode": "json"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    ids = data.get("esearchresult", {}).get("idlist", [])
                    for pmid in ids[:2]:
                        detail = await client.get(
                            f"{PUBMED_EUTILS_BASE}/esummary.fcgi",
                            params={"db": "pubmed", "id": pmid, "retmode": "json"},
                        )
                        if detail.status_code == 200:
                            detail_data = detail.json()
                            uid_data = detail_data.get("result", {}).get(pmid, {})
                            results.append({
                                "source": "pubmed",
                                "term": term,
                                "title": uid_data.get("title", ""),
                                "source_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                            })
            except Exception as e:
                logger.debug("PubMed query failed for '%s': %s", term, e)
    return results


async def enrich_legal(entities: dict[str, list[str]]) -> list[dict[str, Any]]:
    """Query CourtListener API for legal context."""
    results: list[dict[str, Any]] = []
    search_terms = entities.get("legal_refs", [])[:5]
    async with httpx.AsyncClient(timeout=10.0) as client:
        for term in search_terms:
            try:
                resp = await client.get(
                    f"{COURTLISTENER_BASE}/opinions/",
                    params={"search": term, "format": "json", "page_size": 3},
                    headers={"User-Agent": "Cognitus/1.0 (research)"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    for r in data.get("results", [])[:2]:
                        results.append({
                            "source": "courtlistener",
                            "term": term,
                            "title": r.get("caseName", ""),
                            "source_url": r.get("absolute_url", ""),
                        })
            except Exception as e:
                logger.debug("CourtListener query failed for '%s': %s", term, e)
    return results


async def enrich_startup(entities: dict[str, list[str]]) -> list[dict[str, Any]]:
    """Query SEC EDGAR for company filings."""
    results: list[dict[str, Any]] = []
    companies = entities.get("organizations", [])[:3]
    async with httpx.AsyncClient(timeout=10.0) as client:
        for company in companies:
            try:
                # SEC EDGAR requires CIK lookup first
                cik_resp = await client.get(
                    "https://www.sec.gov/cgi-bin/browse-edgar",
                    params={"company": company, "owner": "exclude", "action": "getcompany", "output": "json"},
                    headers={"User-Agent": "Cognitus/1.0 (research)"},
                )
                if cik_resp.status_code == 200:
                    cik_data = cik_resp.json()
                    if cik_data.get("query", {}).get("results"):
                        results.append({
                            "source": "sec_edgar",
                            "term": company,
                            "title": f"SEC filings for {company}",
                            "source_url": f"https://www.sec.gov/cgi-bin/browse-edgar?company={company}",
                        })
            except Exception as e:
                logger.debug("SEC EDGAR query failed for '%s': %s", company, e)
    return results


async def enrich_engineering(entities: dict[str, list[str]]) -> list[dict[str, Any]]:
    """Query NVD CVE API for vulnerability context."""
    results: list[dict[str, Any]] = []
    search_terms = entities.get("organizations", [])[:3]
    async with httpx.AsyncClient(timeout=10.0) as client:
        for term in search_terms:
            try:
                resp = await client.get(
                    NVD_CVE_BASE,
                    params={"keywordSearch": term, "resultsPerPage": 3},
                    headers={"User-Agent": "Cognitus/1.0"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    for vuln in data.get("vulnerabilities", [])[:2]:
                        cve = vuln.get("cve", {})
                        results.append({
                            "source": "nvd_cve",
                            "term": term,
                            "title": cve.get("id", ""),
                            "description": cve.get("descriptions", [{}])[0].get("value", "")[:300],
                            "source_url": f"https://nvd.nist.gov/vuln/detail/{cve.get('id', '')}",
                        })
            except Exception as e:
                logger.debug("NVD CVE query failed for '%s': %s", term, e)
    return results


DOMAIN_ENRICHMENT_MAP: dict[str, callable] = {
    "medical": enrich_medical,
    "legal": enrich_legal,
    "startup": enrich_startup,
    "engineering": enrich_engineering,
}


async def domain_api_enrichment(
    template: str,
    entities: dict[str, list[str]],
) -> list[dict[str, Any]]:
    """Query domain-specific APIs based on the case template."""
    enrich_fn = DOMAIN_ENRICHMENT_MAP.get(template)
    if enrich_fn is None:
        return []
    try:
        return await enrich_fn(entities)
    except Exception as e:
        logger.warning("Domain enrichment failed for '%s': %s", template, e)
        return []


# ---------------------------------------------------------------------------
# Main enrichment pipeline
# ---------------------------------------------------------------------------


async def run_enrichment_pipeline(
    document_text: str,
    question: str,
    template: str = "general",
) -> dict[str, Any]:
    """Run the full enrichment pipeline and yield status updates.

    Returns assembled enriched context.
    """
    enriched: dict[str, Any] = {
        "raw_text": document_text[:6000],
        "entities": {},
        "web_data": [],
        "domain_data": [],
    }

    # 1. Entity extraction
    entities = await extract_entities(document_text)
    enriched["entities"] = entities

    # 2. Web search enrichment
    if settings.ENRICHMENT_ENABLED:
        web_data = await web_search_enrichment(entities, question)
        enriched["web_data"] = web_data

        # 3. Domain API enrichment
        domain_data = await domain_api_enrichment(template, entities)
        enriched["domain_data"] = domain_data

    # Assemble enriched context
    context_parts = [f"=== ORIGINAL DOCUMENT ===\n{document_text[:4000]}\n"]

    if enriched["web_data"]:
        context_parts.append("\n=== WEB CONTEXT ===\n")
        for item in enriched["web_data"][:5]:
            context_parts.append(f"- {item.get('title', '')}: {item.get('content', '')[:300]}")
            context_parts.append(f"  Source: {item.get('url', '')}")

    if enriched["domain_data"]:
        context_parts.append("\n=== DOMAIN SOURCES ===\n")
        for item in enriched["domain_data"][:5]:
            context_parts.append(f"- {item.get('source', '')}: {item.get('title', '')}")
            context_parts.append(f"  URL: {item.get('source_url', '')}")

    enriched["assembled_context"] = "\n".join(context_parts)
    return enriched
