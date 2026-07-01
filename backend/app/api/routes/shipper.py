import asyncio
import logging
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.models.schemas import (
    DISTRIBUTED_BY,
    ErrorResponse,
    ExtractResponse,
    FileListResponse,
    GenerateResponse,
    MissingField,
    ShipperData,
    ShipperDataInput,
)
from app.services.validation import get_missing_fields
from app.services.azure_storage import (
    AzureUnavailableError,
    AzureUploadError,
    list_blobs_by_date_range,
    upload_pdf_to_blob,
)
from app.services.database import DatabaseUnavailableError, MaterialNotFoundError, get_material_details
from app.services.extractor import ExtractionError, extract_formula_data, extract_storage_data
from app.services.pdf_generator import PDFGenerationError, fill_template
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "templates", "shipper_template.pdf")

_generated_files: dict[str, str] = {}
_upload_status: dict[str, str] = {}  # "uploading" | "uploaded" | "failed"


def _validate_pdf(file: UploadFile) -> None:
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(
            status_code=415,
            detail="Only PDF files are accepted",
        )
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(
            status_code=415,
            detail="File must have a .pdf extension",
        )


def _sanitize_path_segment(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", value)


async def _upload_to_azure_background(output_path: str, blob_name: str, document_id: str) -> None:
    """Upload the generated PDF to Azure in the background (non-blocking)."""
    _upload_status[document_id] = "uploading"
    try:
        await asyncio.to_thread(upload_pdf_to_blob, output_path, blob_name)
        _upload_status[document_id] = "uploaded"
        logger.info("Background Azure upload completed for document %s → %s", document_id, blob_name)
    except Exception as e:
        _upload_status[document_id] = "failed"
        logger.error("Background Azure upload failed for document %s: %s", document_id, str(e))


@router.post("/shipper/extract", response_model=ExtractResponse)
async def extract_shipper_data(
    material_number: str = Form(...),
    formula_pdf: UploadFile = File(...),
    storage_pdf: UploadFile = File(...),
) -> ExtractResponse:
    if not material_number or not material_number.strip():
        raise HTTPException(status_code=400, detail="material_number is required")

    _validate_pdf(formula_pdf)
    _validate_pdf(storage_pdf)

    formula_bytes = await formula_pdf.read()
    storage_bytes = await storage_pdf.read()

    if len(formula_bytes) > settings.max_file_size_bytes:
        raise HTTPException(status_code=413, detail=f"formula_pdf exceeds {settings.max_file_size_mb}MB limit")
    if len(storage_bytes) > settings.max_file_size_bytes:
        raise HTTPException(status_code=413, detail=f"storage_pdf exceeds {settings.max_file_size_mb}MB limit")

    if len(formula_bytes) < 4 or formula_bytes[:4] != b"%PDF":
        raise HTTPException(status_code=415, detail="formula_pdf does not appear to be a valid PDF")
    if len(storage_bytes) < 4 or storage_bytes[:4] != b"%PDF":
        raise HTTPException(status_code=415, detail="storage_pdf does not appear to be a valid PDF")

    # DB lookup is best-effort — any material number is accepted
    db_data: dict = {}
    try:
        db_data = get_material_details(material_number.strip())
    except MaterialNotFoundError:
        logger.info("Material number '%s' not in DB — user will fill fields manually", material_number)
    except (DatabaseUnavailableError, Exception) as e:
        logger.warning("DB lookup skipped: %s", str(e))

    try:
        formula_data = extract_formula_data(formula_bytes)
    except ExtractionError as e:
        logger.error("Formula extraction failed: %s", str(e))
        raise HTTPException(status_code=422, detail="Failed to extract data from Master Formula PDF")
    except Exception as e:
        logger.error("Unexpected extraction error: %s", str(e))
        raise HTTPException(status_code=500, detail="An unexpected error occurred during formula extraction")

    try:
        storage_data = extract_storage_data(storage_bytes)
    except ExtractionError as e:
        logger.error("Storage extraction failed: %s", str(e))
        raise HTTPException(status_code=422, detail="Failed to extract data from Storage and Shipping PDF")
    except Exception as e:
        logger.error("Unexpected extraction error: %s", str(e))
        raise HTTPException(status_code=500, detail="An unexpected error occurred during storage extraction")

    combined = ShipperData(
        product_name=db_data.get("product_name", ""),
        gtin=db_data.get("gtin", ""),
        quantity=db_data.get("quantity_per_case", ""),
        inner_pack=db_data.get("inner_pack", ""),
        material_number=material_number.strip(),
        label_specification=db_data.get("label_specification_number", ""),
        storage_requirements=storage_data.get("storage_requirements") or None,
        batch_number=storage_data.get("batch_number") or None,
        expiration_date=storage_data.get("expiration_date") or None,
        active_ingredient=formula_data.get("active_ingredient") or None,
        distributed_by=DISTRIBUTED_BY,
    )

    raw_missing = get_missing_fields(combined.model_dump())
    missing = [MissingField(field=f, label=lbl) for f, lbl in raw_missing]

    if missing:
        logger.warning(
            "Extraction incomplete — %d field(s) need manual entry: %s",
            len(missing),
            [m.field for m in missing],
        )

    return ExtractResponse(success=True, data=combined, missing_fields=missing)


@router.post("/shipper/generate", response_model=GenerateResponse)
async def generate_shipper_label(
    input_data: ShipperDataInput,
    background_tasks: BackgroundTasks,
) -> GenerateResponse:
    """
    Generate the shipper label PDF and schedule Azure upload as a background task.
    Returns immediately after PDF generation so the frontend never times out.
    """
    final_data = input_data.model_dump()
    final_data["distributed_by"] = DISTRIBUTED_BY

    document_id = str(uuid.uuid4())
    tmp_dir = tempfile.mkdtemp()
    output_path = os.path.join(tmp_dir, f"{document_id}.pdf")

    try:
        fill_template(final_data, TEMPLATE_PATH, output_path)
    except PDFGenerationError as e:
        logger.error("PDF generation failed: %s", str(e))
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail="Failed to generate the shipper label PDF")
    except Exception as e:
        logger.error("Unexpected PDF error: %s", str(e))
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="An unexpected error occurred during PDF generation")

    mat = _sanitize_path_segment(input_data.material_number)
    batch = _sanitize_path_segment(input_data.batch_number)
    folder = settings.azure_blob_target_folder
    blob_name = f"{folder}/{mat}/{batch}/final_shipper.pdf"

    _generated_files[document_id] = output_path
    _upload_status[document_id] = "uploading"

    background_tasks.add_task(_upload_to_azure_background, output_path, blob_name, document_id)

    logger.info("Shipper label generated, Azure upload queued in background: %s", blob_name)

    return GenerateResponse(
        success=True,
        message="Shipper label generated successfully",
        document_id=document_id,
        file_name="final_shipper.pdf",
        blob_path=blob_name,
        download_url=f"/api/v1/shipper/download/{document_id}",
    )


@router.get("/shipper/status/{document_id}")
async def get_upload_status(document_id: str) -> dict:
    """Check the Azure upload status for a generated document."""
    if not re.match(r"^[a-f0-9\-]{36}$", document_id):
        raise HTTPException(status_code=400, detail="Invalid document ID")
    status = _upload_status.get(document_id, "unknown")
    return {"document_id": document_id, "status": status}


@router.get("/shipper/download/{document_id}")
async def download_shipper_label(document_id: str) -> FileResponse:
    if not re.match(r"^[a-f0-9\-]{36}$", document_id):
        raise HTTPException(status_code=400, detail="Invalid document ID")

    file_path = _generated_files.get(document_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found or has expired")

    return FileResponse(
        path=file_path,
        media_type="application/pdf",
        filename="final_shipper.pdf",
        headers={"Content-Disposition": 'attachment; filename="final_shipper.pdf"'},
    )


@router.get("/shipper/files", response_model=FileListResponse)
async def list_files_by_date_range(
    start_date: str = Query(..., description="Start date in YYYY-MM-DD format"),
    end_date: str = Query(..., description="End date in YYYY-MM-DD format (inclusive)"),
) -> FileListResponse:
    """
    List all files in Azure Blob Storage that were last modified between start_date and end_date (inclusive).
    """
    from datetime import datetime

    try:
        datetime.strptime(start_date, "%Y-%m-%d")
        datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid date format — use YYYY-MM-DD (e.g. 2026-01-01)",
        )

    if start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail="start_date must be on or before end_date",
        )

    try:
        files = await asyncio.to_thread(list_blobs_by_date_range, start_date, end_date)
    except AzureUnavailableError as e:
        logger.error("Azure unavailable for file listing: %s", str(e))
        raise HTTPException(status_code=503, detail="Azure Blob Storage is not available")
    except Exception as e:
        logger.error("Unexpected error listing blobs: %s", str(e))
        raise HTTPException(status_code=500, detail="An unexpected error occurred listing files")

    return FileListResponse(
        success=True,
        files=files,
        total=len(files),
        start_date=start_date,
        end_date=end_date,
    )
