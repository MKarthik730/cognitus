from __future__ import annotations

import base64
import io
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/case-study", tags=["case-study"])

SUPPORTED_TYPES = {
    ".pdf": "pdf",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
    ".md": "text",
    ".txt": "text",
    ".csv": "text",
    ".docx": "docx",
}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = Path(file.filename or "unknown").suffix.lower()
    file_type = SUPPORTED_TYPES.get(ext)
    if not file_type:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    file_id = str(uuid.uuid4())
    raw_content = ""

    try:
        if ext == ".pdf":
            raw_content = await _extract_pdf(file)
        elif ext == ".docx":
            raw_content = await _extract_docx(file)
        elif file_type == "text":
            raw_content = await _extract_text(file)
        elif file_type == "image":
            raw_content = await _analyze_image(file, file.filename or "unknown")
    except Exception as e:
        logger.error("Failed to process file %s: %s", file.filename, e)
        return {
            "id": file_id,
            "name": file.filename or "unknown",
            "type": ext.lstrip("."),
            "rawContent": "",
            "status": "failed",
        }

    return {
        "id": file_id,
        "name": file.filename or "unknown",
        "type": ext.lstrip("."),
        "rawContent": raw_content,
        "status": "ready",
    }


async def _extract_pdf(file: UploadFile) -> str:
    import fitz

    content = await file.read()
    doc = fitz.open(stream=content, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    return text.strip()


async def _extract_docx(file: UploadFile) -> str:
    import docx

    content = await file.read()
    doc = docx.Document(io.BytesIO(content))
    text = "\n".join(p.text for p in doc.paragraphs)
    return text.strip()


async def _extract_text(file: UploadFile) -> str:
    content = await file.read()
    return content.decode("utf-8").strip()


async def _analyze_image(file: UploadFile, filename: str) -> str:
    from app.services.hf_service import HFService

    content = await file.read()
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext == "jpg":
        ext = "jpeg"
    b64 = base64.b64encode(content).decode("utf-8")
    data_uri = f"data:image/{ext};base64,{b64}"

    hf_service = HFService()
    try:
        result = await hf_service.generate_with_image(
            system="Describe all visible content in this image in detail. Include all text, numbers, labels, measurements, and observations. Be exhaustive.",
            user="Describe this image in detail.",
            image_data_uri=data_uri,
        )
        return result
    except Exception as e:
        logger.warning("Image analysis failed, falling back to filename: %s", e)
        return f"[Image file: {filename}]"
