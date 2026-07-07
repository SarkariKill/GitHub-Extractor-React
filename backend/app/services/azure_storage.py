"""
Azure Blob Storage service — upload and list blobs.
"""
import logging
import os

logger = logging.getLogger(__name__)


class AzureUploadError(Exception):
    pass


class AzureUnavailableError(Exception):
    pass


def upload_pdf_to_blob(output_path: str, blob_name: str) -> str:
    """
    Upload a generated PDF to Azure Blob Storage.

    Args:
        output_path: Local path of the PDF file to upload
        blob_name:   Target blob name in the container

    Returns:
        The blob path (blob_name) on success
    """
    from app.core.config import settings

    if not os.path.exists(output_path):
        raise AzureUploadError(f"Local file not found: {output_path}")

    connection_string = settings.azure_storage_connection_string
    container_name = settings.azure_blob_container_name

    if not connection_string:
        logger.warning(
            "AZURE_STORAGE_CONNECTION_STRING not set — skipping upload (stub mode)"
        )
        return blob_name

    try:
        from azure.storage.blob import BlobServiceClient

        blob_service = BlobServiceClient.from_connection_string(connection_string)
        container_client = blob_service.get_container_client(container_name)

        try:
            container_client.create_container()
        except Exception:
            pass

        with open(output_path, "rb") as f:
            container_client.upload_blob(name=blob_name, data=f, overwrite=True)

        logger.info("Uploaded PDF to Azure blob: %s", blob_name)
        return blob_name

    except Exception as e:
        logger.error("Azure upload failed: %s", str(e))
        raise AzureUploadError(f"Azure upload failed: {str(e)}") from e


GENERATED_FOLDER = "final_generated_shipped_pdf"


def list_generated_pdfs() -> list[dict]:
    """
    List all PDF files inside the final_generated_shipped_pdf/ folder.

    Returns a list of dicts: [{name, blob_name, uploaded_at}] sorted newest first.
    """
    from app.core.config import settings

    connection_string = settings.azure_storage_connection_string
    container_name = settings.azure_blob_container_name

    if not connection_string:
        logger.warning("AZURE_STORAGE_CONNECTION_STRING not set — returning empty list (stub mode)")
        return []

    try:
        from azure.storage.blob import BlobServiceClient

        blob_service = BlobServiceClient.from_connection_string(connection_string)
        container_client = blob_service.get_container_client(container_name)

        results = []
        prefix = f"{GENERATED_FOLDER}/"
        for blob in container_client.list_blobs(name_starts_with=prefix):
            name = blob.name[len(prefix):]
            if not name or not name.lower().endswith(".pdf"):
                continue
            results.append({
                "name": name,
                "blob_name": blob.name,
                "uploaded_at": blob.last_modified.isoformat() if blob.last_modified else None,
                "size_kb": round((blob.size or 0) / 1024, 1),
            })

        results.sort(key=lambda x: x["uploaded_at"] or "", reverse=True)
        logger.info("Listed %d files in %s", len(results), GENERATED_FOLDER)
        return results

    except Exception as e:
        logger.error("Failed to list generated PDFs: %s", str(e))
        raise AzureUnavailableError(f"Failed to list blobs: {str(e)}") from e


def download_blob_bytes(blob_name: str) -> bytes:
    """
    Download a specific blob from Azure and return its raw bytes.
    """
    from app.core.config import settings

    connection_string = settings.azure_storage_connection_string
    container_name = settings.azure_blob_container_name

    if not connection_string:
        raise AzureUnavailableError("Azure connection string not configured")

    try:
        from azure.storage.blob import BlobServiceClient

        blob_service = BlobServiceClient.from_connection_string(connection_string)
        blob_client = blob_service.get_blob_client(container=container_name, blob=blob_name)
        data = blob_client.download_blob().readall()
        logger.info("Downloaded blob: %s (%d bytes)", blob_name, len(data))
        return data

    except Exception as e:
        err = str(e)
        if "BlobNotFound" in err or "404" in err:
            raise FileNotFoundError(f"Blob not found: {blob_name}") from e
        logger.error("Failed to download blob '%s': %s", blob_name, err)
        raise AzureUnavailableError(f"Download failed: {err}") from e


def list_blobs_by_date_range(start_date: str, end_date: str) -> list[str]:
    """
    List all blobs in the configured container modified between start_date and end_date (inclusive).

    Args:
        start_date: YYYY-MM-DD string (inclusive)
        end_date:   YYYY-MM-DD string (inclusive — end of day is used)

    Returns:
        List of blob names matching the date range
    """
    from app.core.config import settings
    from datetime import datetime, timedelta

    connection_string = settings.azure_storage_connection_string
    container_name = settings.azure_blob_container_name

    if not connection_string:
        logger.warning("AZURE_STORAGE_CONNECTION_STRING not set — returning empty list (stub mode)")
        return []

    try:
        from azure.storage.blob import BlobServiceClient

        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)

        blob_service = BlobServiceClient.from_connection_string(connection_string)
        container_client = blob_service.get_container_client(container_name)

        matching: list[str] = []
        for blob in container_client.list_blobs():
            last_modified = blob.last_modified.replace(tzinfo=None)
            if start <= last_modified < end:
                matching.append(blob.name)

        logger.info(
            "Found %d blobs modified between %s and %s",
            len(matching), start_date, end_date,
        )
        return matching

    except Exception as e:
        logger.error("Azure blob listing failed: %s", str(e))
        raise AzureUnavailableError(f"Failed to list blobs: {str(e)}") from e
