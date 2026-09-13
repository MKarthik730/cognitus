"""Live/real-time source fetching: curated open-source feeds + user-supplied URLs.

Two independent, opt-in knobs for a single analysis request:
  - `research_categories`: pull from a hardcoded catalog of free, no-API-key
    RSS/Atom feeds and public APIs, grouped by audience (students, researchers,
    finance, tech news, world news, legal).
  - `custom_urls`: fetch a small number of user-supplied URLs directly.

Every fetch is best-effort and independently isolated — a broken feed or an
unreachable custom URL never aborts the analysis, it's just omitted from the
returned list.

SSRF guard: only http(s) URLs are fetched, redirects are never followed, and
the resolved IP of the hostname is rejected if it falls in a private/loopback/
link-local/reserved range. This matters specifically for `custom_urls`, which
come straight from the browser — without it, a user could point the backend
at an internal service (e.g. http://localhost:6379, http://169.254.169.254/).
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
import xml.etree.ElementTree as ET
from typing import Any, Awaitable, Callable
from urllib.parse import quote_plus, urlparse

import httpx

logger = logging.getLogger(__name__)

FETCH_TIMEOUT = 8.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024  # 2MB cap per fetch
MAX_CUSTOM_URLS = 5
MAX_ITEMS_PER_SOURCE = 4
_USER_AGENT = "Cognitus-Research/1.0 (+https://github.com/MKarthik730/cognitus)"


# ---------------------------------------------------------------------------
# SSRF-safe fetch primitives
# ---------------------------------------------------------------------------

def _is_url_safe(url: str) -> bool:
    """Reject anything that isn't a plain public http(s) URL."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = parsed.hostname
    if not host:
        return False
    if host.lower() == "localhost":
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


async def _fetch_raw(url: str, params: dict[str, Any] | None = None) -> tuple[str, str] | None:
    """Fetch a URL and return (content_type, decoded_text), or None if blocked/failed.

    Never follows redirects (a redirect to a private host would bypass the
    safety check) and caps how many bytes are read regardless of what the
    server claims or sends.
    """
    if not await asyncio.to_thread(_is_url_safe, url):
        logger.warning("Blocked unsafe/private URL: %s", url)
        return None
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=False) as client:
            async with client.stream(
                "GET", url, params=params, headers={"User-Agent": _USER_AGENT}
            ) as response:
                if response.status_code >= 300:
                    return None
                content_type = response.headers.get("content-type", "")
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_RESPONSE_BYTES:
                        break
                    chunks.append(chunk)
                return content_type, b"".join(chunks).decode("utf-8", errors="ignore")
    except Exception as e:
        logger.debug("Fetch failed for %s: %s", url, e)
        return None


async def _fetch_json(url: str, params: dict[str, Any] | None = None) -> Any:
    result = await _fetch_raw(url, params)
    if result is None:
        return None
    import json
    try:
        return json.loads(result[1])
    except Exception:
        return None


def _strip_html(text: str, max_chars: int) -> str:
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:max_chars]


def _parse_feed_items(xml_text: str, max_items: int = MAX_ITEMS_PER_SOURCE) -> list[dict[str, str]]:
    """Parse RSS 2.0 <item> or Atom <entry> elements into a common shape."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    items: list[dict[str, str]] = []
    for item in root.findall(".//item")[:max_items]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        desc = _strip_html(item.findtext("description") or "", 400)
        items.append({"title": title, "source_url": link, "content": desc})
    if items:
        return items

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    for entry in root.findall(".//atom:entry", ns)[:max_items]:
        title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
        link_el = entry.find("atom:link", ns)
        link = link_el.get("href", "") if link_el is not None else ""
        summary = (
            entry.findtext("atom:summary", default="", namespaces=ns)
            or entry.findtext("atom:content", default="", namespaces=ns)
            or ""
        )
        items.append({"title": title, "source_url": link, "content": _strip_html(summary, 400)})
    return items


async def fetch_custom_url(url: str) -> dict[str, Any] | None:
    """Fetch one user-supplied URL and return a single context snippet."""
    result = await _fetch_raw(url)
    if result is None:
        return None
    content_type, body = result

    looks_like_feed = "xml" in content_type or body.lstrip()[:200].lower().find("<rss") != -1 or body.lstrip()[:200].lower().find("<feed") != -1
    if looks_like_feed:
        items = _parse_feed_items(body, max_items=1)
        if items:
            return {
                "source": "custom",
                "title": items[0]["title"] or url,
                "content": items[0]["content"],
                "source_url": items[0].get("source_url") or url,
            }

    text = _strip_html(body, 1500)
    if not text:
        return None
    return {"source": "custom", "title": url, "content": text, "source_url": url}


async def gather_custom_urls(urls: list[str]) -> list[dict[str, Any]]:
    """Fetch up to MAX_CUSTOM_URLS user-supplied URLs concurrently."""
    candidates = [u.strip() for u in urls if u and u.strip()][:MAX_CUSTOM_URLS]
    if not candidates:
        return []
    results = await asyncio.gather(*(fetch_custom_url(u) for u in candidates), return_exceptions=True)
    return [r for r in results if isinstance(r, dict)]


# ---------------------------------------------------------------------------
# Named query functions — one implementation per free API, reused across
# categories in the catalog below.
# ---------------------------------------------------------------------------

async def _q_wikipedia(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://en.wikipedia.org/w/rest.php/v1/search/page", {"q": query, "limit": MAX_ITEMS_PER_SOURCE})
    return [
        {"title": p.get("title", ""), "content": p.get("excerpt", ""), "source_url": f"https://en.wikipedia.org/wiki/{quote_plus(p.get('title', ''))}"}
        for p in (data or {}).get("pages", [])[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_arxiv(query: str) -> list[dict[str, Any]]:
    result = await _fetch_raw("https://export.arxiv.org/api/query", {"search_query": f"all:{query}", "start": 0, "max_results": MAX_ITEMS_PER_SOURCE})
    if result is None:
        return []
    return _parse_feed_items(result[1], MAX_ITEMS_PER_SOURCE)


async def _q_hackernews(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://hn.algolia.com/api/v1/search", {"query": query, "tags": "story", "hitsPerPage": MAX_ITEMS_PER_SOURCE})
    return [
        {
            "title": h.get("title", ""),
            "content": h.get("story_text") or "",
            "source_url": h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID', '')}",
        }
        for h in (data or {}).get("hits", [])[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_github(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://api.github.com/search/repositories", {"q": query, "sort": "stars", "order": "desc", "per_page": MAX_ITEMS_PER_SOURCE})
    return [
        {"title": r.get("full_name", ""), "content": (r.get("description") or "")[:300], "source_url": r.get("html_url", "")}
        for r in (data or {}).get("items", [])[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_devto(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://dev.to/api/articles", {"per_page": MAX_ITEMS_PER_SOURCE})
    return [
        {"title": a.get("title", ""), "content": (a.get("description") or "")[:300], "source_url": a.get("url", "")}
        for a in (data or [])[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_coingecko(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://api.coingecko.com/api/v3/search/trending")
    return [
        {
            "title": (c.get("item") or {}).get("name", ""),
            "content": f"Rank #{(c.get('item') or {}).get('market_cap_rank', '?')}, symbol {(c.get('item') or {}).get('symbol', '')}",
            "source_url": f"https://www.coingecko.com/en/coins/{(c.get('item') or {}).get('id', '')}",
        }
        for c in (data or {}).get("coins", [])[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_sec_edgar(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://efts.sec.gov/LATEST/search-index", {"q": query, "from": 0, "size": MAX_ITEMS_PER_SOURCE})
    hits = (data or {}).get("hits", {}).get("hits", [])
    return [
        {
            "title": (h.get("_source", {}).get("display_names") or [""])[0],
            "content": h.get("_source", {}).get("form", ""),
            "source_url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={quote_plus(query)}",
        }
        for h in hits[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_gdelt(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://api.gdeltproject.org/api/v2/doc/doc", {"query": query, "mode": "artlist", "format": "json", "maxrecords": MAX_ITEMS_PER_SOURCE, "sort": "HybridRel"})
    return [
        {"title": a.get("title", ""), "content": a.get("seendate", ""), "source_url": a.get("url", "")}
        for a in (data or {}).get("articles", [])[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_semantic_scholar(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://api.semanticscholar.org/graph/v1/paper/search", {"query": query, "limit": MAX_ITEMS_PER_SOURCE, "fields": "title,abstract,url"})
    return [
        {"title": p.get("title", ""), "content": (p.get("abstract") or "")[:400], "source_url": p.get("url", "")}
        for p in (data or {}).get("data", [])[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_openalex(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://api.openalex.org/works", {"search": query, "per-page": MAX_ITEMS_PER_SOURCE})
    return [
        {"title": w.get("title", ""), "content": str(w.get("publication_year", "")), "source_url": w.get("doi") or w.get("id", "")}
        for w in (data or {}).get("results", [])[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_crossref(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://api.crossref.org/works", {"query": query, "rows": MAX_ITEMS_PER_SOURCE, "select": "title,DOI,URL"})
    items = (data or {}).get("message", {}).get("items", [])
    return [
        {"title": (it.get("title") or [""])[0], "content": "", "source_url": it.get("URL") or f"https://doi.org/{it.get('DOI', '')}"}
        for it in items[:MAX_ITEMS_PER_SOURCE]
    ]


async def _q_pubmed(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {"db": "pubmed", "term": query, "retmax": MAX_ITEMS_PER_SOURCE, "retmode": "json"})
    ids = (data or {}).get("esearchresult", {}).get("idlist", [])
    return [{"title": f"PubMed record {pmid}", "content": "", "source_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"} for pmid in ids[:MAX_ITEMS_PER_SOURCE]]


async def _q_nvd(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://services.nvd.nist.gov/rest/json/cves/2.0", {"keywordSearch": query, "resultsPerPage": MAX_ITEMS_PER_SOURCE})
    results = []
    for v in (data or {}).get("vulnerabilities", [])[:MAX_ITEMS_PER_SOURCE]:
        cve = v.get("cve", {})
        cve_id = cve.get("id", "")
        desc = next((d.get("value", "") for d in cve.get("descriptions", []) if d.get("lang") == "en"), "")
        results.append({"title": cve_id, "content": desc[:400], "source_url": f"https://nvd.nist.gov/vuln/detail/{cve_id}"})
    return results


async def _q_courtlistener(query: str) -> list[dict[str, Any]]:
    data = await _fetch_json("https://www.courtlistener.com/api/rest/v3/search/", {"q": query, "type": "o", "order_by": "dateFiled desc"})
    return [
        {"title": r.get("caseName", ""), "content": (r.get("snippet") or "")[:400], "source_url": r.get("absolute_url", "")}
        for r in (data or {}).get("results", [])[:MAX_ITEMS_PER_SOURCE]
    ]


QUERY_FNS: dict[str, Callable[[str], Awaitable[list[dict[str, Any]]]]] = {
    "wikipedia": _q_wikipedia,
    "arxiv": _q_arxiv,
    "hackernews": _q_hackernews,
    "github": _q_github,
    "devto": _q_devto,
    "coingecko": _q_coingecko,
    "sec_edgar": _q_sec_edgar,
    "gdelt": _q_gdelt,
    "semantic_scholar": _q_semantic_scholar,
    "openalex": _q_openalex,
    "crossref": _q_crossref,
    "pubmed": _q_pubmed,
    "nvd": _q_nvd,
    "courtlistener": _q_courtlistener,
}


# ---------------------------------------------------------------------------
# Curated catalog — free, no-API-key sources grouped by audience.
# Each entry is either a static feed (`kind: "feed"`, fetched as-is, ignoring
# the question) or a live query against one of the QUERY_FNS above.
# ---------------------------------------------------------------------------

CURATED_SOURCES: dict[str, list[dict[str, str]]] = {
    "students": [
        {"name": "Wikipedia", "kind": "query", "query_fn": "wikipedia"},
        {"name": "arXiv — new CS submissions", "kind": "feed", "url": "http://export.arxiv.org/rss/cs"},
        {"name": "dev.to — programming articles", "kind": "query", "query_fn": "devto"},
        {"name": "GitHub — open source projects", "kind": "query", "query_fn": "github"},
    ],
    "researchers": [
        {"name": "arXiv", "kind": "query", "query_fn": "arxiv"},
        {"name": "Semantic Scholar", "kind": "query", "query_fn": "semantic_scholar"},
        {"name": "OpenAlex", "kind": "query", "query_fn": "openalex"},
        {"name": "Crossref", "kind": "query", "query_fn": "crossref"},
        {"name": "PubMed", "kind": "query", "query_fn": "pubmed"},
    ],
    "finance": [
        {"name": "SEC EDGAR — filings search", "kind": "query", "query_fn": "sec_edgar"},
        {"name": "CoinGecko — trending crypto", "kind": "query", "query_fn": "coingecko"},
        {"name": "MarketWatch — Top Stories", "kind": "feed", "url": "http://feeds.marketwatch.com/marketwatch/topstories/"},
        {"name": "Federal Reserve — Press Releases", "kind": "feed", "url": "https://www.federalreserve.gov/feeds/press_all.xml"},
    ],
    "tech_news": [
        {"name": "Hacker News", "kind": "query", "query_fn": "hackernews"},
        {"name": "NVD — Vulnerabilities", "kind": "query", "query_fn": "nvd"},
        {"name": "dev.to", "kind": "query", "query_fn": "devto"},
        {"name": "GitHub", "kind": "query", "query_fn": "github"},
    ],
    "world_news": [
        {"name": "GDELT — global news", "kind": "query", "query_fn": "gdelt"},
        {"name": "BBC News", "kind": "feed", "url": "http://feeds.bbci.co.uk/news/rss.xml"},
        {"name": "Wikipedia", "kind": "query", "query_fn": "wikipedia"},
    ],
    "legal": [
        {"name": "CourtListener", "kind": "query", "query_fn": "courtlistener"},
        {"name": "GDELT — global news", "kind": "query", "query_fn": "gdelt"},
    ],
}


async def _fetch_source(source: dict[str, str], query: str) -> list[dict[str, Any]]:
    try:
        if source["kind"] == "feed":
            result = await _fetch_raw(source["url"])
            items = _parse_feed_items(result[1]) if result else []
        else:
            fn = QUERY_FNS.get(source.get("query_fn", ""))
            items = await fn(query) if fn else []
    except Exception as e:
        logger.debug("Curated source '%s' failed: %s", source.get("name"), e)
        return []

    for item in items:
        item["source"] = source["name"]
    return items


async def gather_curated_sources(categories: list[str], query: str) -> list[dict[str, Any]]:
    """Fetch every source in the requested categories concurrently."""
    sources: list[dict[str, str]] = []
    for category in categories:
        sources.extend(CURATED_SOURCES.get(category, []))
    if not sources:
        return []
    results = await asyncio.gather(*(_fetch_source(s, query) for s in sources), return_exceptions=True)
    combined: list[dict[str, Any]] = []
    for r in results:
        if isinstance(r, list):
            combined.extend(r)
    return combined
