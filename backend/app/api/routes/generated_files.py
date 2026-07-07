import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.services.azure_storage import AzureUnavailableError, list_generated_pdfs, download_blob_bytes

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/generated-files/list")
async def list_generated_files() -> dict:
    try:
        files = await asyncio.to_thread(list_generated_pdfs)
        return {"success": True, "files": files, "total": len(files)}
    except AzureUnavailableError:
        raise HTTPException(status_code=503, detail="Azure Blob Storage is not available")
    except Exception as e:
        logger.error("Failed to list generated files: %s", str(e))
        raise HTTPException(status_code=500, detail="Unexpected error listing files")


@router.get("/generated-files/download")
async def download_generated_file(blob: str = Query(..., description="Full blob name to download")) -> StreamingResponse:
    if not blob.startswith("final_generated_shipped_pdf/"):
        raise HTTPException(status_code=400, detail="Invalid blob path")
    if not blob.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF blobs can be downloaded")
    try:
        data = await asyncio.to_thread(download_blob_bytes, blob)
    except AzureUnavailableError:
        raise HTTPException(status_code=503, detail="Azure Blob Storage is not available")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found in Azure")
    except Exception as e:
        logger.error("Failed to download blob '%s': %s", blob, str(e))
        raise HTTPException(status_code=500, detail="Failed to download file")

    filename = blob.split("/")[-1]

    def iter_bytes():
        yield data

    return StreamingResponse(
        iter_bytes(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
