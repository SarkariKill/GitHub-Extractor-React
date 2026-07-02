"""
Dynamic template schema service.

Reads Excel files from Azure Blob Storage (or a local fallback folder) to
build the field definitions shown in Step 2 of the UI.

Azure layout (configured via AZURE_BLOB_CONTAINER_NAME + AZURE_EXCEL_FOLDER):
  {container}/{excel_folder}/template1.xlsx
  {container}/{excel_folder}/template2.xlsx
  ...etc — any .xlsx file becomes a selectable template.

Local fallback (used when Azure is unavailable or connection string is not set):
  backend/data/excel/{template_name}.xlsx

Excel columns (row 1 = headers):
  field_key | label | field_type | placeholder | required | readonly | order

  field_key   : internal key (e.g. "product_name") — also accepts "field_name"
  label       : display label shown in the UI
  field_type  : "text" | "date" | "number" | "dropdown"
  placeholder : hint / example value
  required    : yes/no or TRUE/FALSE
  readonly    : yes/no or TRUE/FALSE
  order       : integer — ascending display order

Values and dropdown options come from backend/data/template_values.json.
"""
import io
import json
import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

_DATA_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "data")
)
_LOCAL_EXCEL_DIR = os.path.join(_DATA_DIR, "excel")
_JSON_DB_PATH = os.path.join(_DATA_DIR, "template_values.json")

_list_cache: dict[str, Any] = {"data": None, "fetched_at": 0.0}
_fields_cache: dict[str, dict] = {}
_db_cache: dict[str, Any] = {"data": None, "fetched_at": 0.0}


# ---------------------------------------------------------------------------
# JSON database — loaded from Azure config folder, local file as fallback
# ---------------------------------------------------------------------------

def _read_json_db(force_refresh: bool = False) -> dict:
    """
    Fetch template_values.json from:
      1. Azure Blob: {container}/{azure_config_folder}/template_values.json
      2. Local fallback: backend/data/template_values.json

    Result is cached for schema_cache_ttl_seconds.
    """
    from app.core.config import settings

    now = time.time()
    ttl = settings.schema_cache_ttl_seconds

    if (
        not force_refresh
        and _db_cache["data"] is not None
        and (now - _db_cache["fetched_at"]) < ttl
    ):
        return _db_cache["data"]

    data: dict | None = None

    # 1. Try Azure
    conn_str = settings.azure_storage_connection_string
    if conn_str:
        try:
            from azure.storage.blob import BlobServiceClient
            blob_name = f"{settings.azure_config_folder.rstrip('/')}/template_values.json"
            client = BlobServiceClient.from_connection_string(conn_str)
            blob_client = client.get_blob_client(
                container=settings.azure_blob_container_name, blob=blob_name
            )
            raw = blob_client.download_blob().readall()
            data = json.loads(raw.decode("utf-8"))
            logger.info("Loaded template_values.json from Azure: %s", blob_name)
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON in Azure template_values.json: %s", str(e))
        except Exception as e:
            logger.warning(
                "Could not fetch template_values.json from Azure: %s — trying local", str(e)
            )

    # 2. Local fallback
    if data is None:
        if os.path.exists(_JSON_DB_PATH):
            try:
                with open(_JSON_DB_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                logger.info("Loaded template_values.json from local file: %s", _JSON_DB_PATH)
            except json.JSONDecodeError as e:
                logger.error("Invalid JSON in local template_values.json: %s", str(e))
                data = {}
            except Exception as e:
                logger.error("Could not read local template_values.json: %s", str(e))
                data = {}
        else:
            logger.warning(
                "template_values.json not found in Azure or locally (%s)", _JSON_DB_PATH
            )
            data = {}

    _db_cache["data"] = data
    _db_cache["fetched_at"] = now
    return data


# ---------------------------------------------------------------------------
# Excel parsing
# ---------------------------------------------------------------------------

def _bool_from_cell(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("yes", "true", "1", "y")
    if value is None:
        return default
    return bool(value)


def _parse_excel_bytes(raw_bytes: bytes, template_name: str) -> list[dict]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    if not rows:
        raise ValueError(f"'{template_name}.xlsx' is empty")

    raw_headers = rows[0]
    headers = [str(h).strip().lower() if h is not None else "" for h in raw_headers]

    # Accept "field_name" as alias for "field_key"
    headers = ["field_key" if h == "field_name" else h for h in headers]

    missing = {"field_key", "label"} - set(headers)
    if missing:
        raise ValueError(
            f"'{template_name}.xlsx' is missing required columns: {missing}. "
            f"Found: {[h for h in headers if h]}"
        )

    def col(row: tuple, name: str, default: Any = "") -> Any:
        try:
            idx = headers.index(name)
            v = row[idx]
            return v if v is not None else default
        except ValueError:
            return default

    fields: list[dict] = []
    for row in rows[1:]:
        fkey = str(col(row, "field_key", "")).strip()
        label = str(col(row, "label", "")).strip()
        if not fkey or not label:
            continue

        ft = str(col(row, "field_type", "text")).strip().lower() or "text"
        if ft not in ("text", "date", "number", "dropdown"):
            logger.warning(
                "Unknown field_type '%s' for field '%s' in %s — defaulting to 'text'",
                ft, fkey, template_name,
            )
            ft = "text"

        fields.append({
            "field_key":   fkey,
            "label":       label,
            "field_type":  ft,
            "placeholder": str(col(row, "placeholder", "")).strip(),
            "required":    _bool_from_cell(col(row, "required", None), default=True),
            "readonly":    _bool_from_cell(col(row, "readonly", None), default=False),
            "order":       int(col(row, "order", 999)),
        })

    fields.sort(key=lambda f: f["order"])
    return fields


def _enrich_with_db(fields: list[dict], db: dict) -> list[dict]:
    """Merge raw field defs with JSON DB values/options."""
    enriched = []
    for f in fields:
        key = f["field_key"]
        db_val = db.get(key)
        entry: dict = {
            "field_name":   key,
            "label":        f["label"],
            "field_type":   f["field_type"],
            "placeholder":  f["placeholder"],
            "required":     f["required"],
            "readonly":     f["readonly"],
            "order":        f["order"],
        }

        if f["field_type"] == "dropdown":
            if isinstance(db_val, list) and len(db_val) > 0:
                entry["options"] = db_val
            else:
                if db_val is not None:
                    logger.warning(
                        "JSON DB key '%s' is not a list (got %s) — no options for dropdown",
                        key, type(db_val).__name__,
                    )
                entry["options"] = []
            entry["default_value"] = None
        else:
            if db_val is not None and not isinstance(db_val, list):
                entry["default_value"] = str(db_val)
            else:
                entry["default_value"] = None

        enriched.append(entry)
    return enriched


# ---------------------------------------------------------------------------
# Azure / local file access
# ---------------------------------------------------------------------------

def _fetch_excel_bytes(template_name: str) -> bytes:
    from app.core.config import settings

    conn_str = settings.azure_storage_connection_string
    container = settings.azure_blob_container_name
    folder = settings.azure_excel_folder.rstrip("/")

    if conn_str:
        try:
            from azure.storage.blob import BlobServiceClient
            blob_name = f"{folder}/{template_name}.xlsx"
            client = BlobServiceClient.from_connection_string(conn_str)
            blob_client = client.get_blob_client(container=container, blob=blob_name)
            raw = blob_client.download_blob().readall()
            logger.info("Loaded '%s' from Azure: %s", template_name, blob_name)
            return raw
        except Exception as e:
            logger.warning(
                "Azure fetch failed for '%s.xlsx': %s — trying local fallback",
                template_name, str(e),
            )

    local_path = os.path.join(_LOCAL_EXCEL_DIR, f"{template_name}.xlsx")
    if os.path.exists(local_path):
        with open(local_path, "rb") as fh:
            logger.info("Loaded '%s' from local file: %s", template_name, local_path)
            return fh.read()

    raise FileNotFoundError(
        f"Template '{template_name}' not found in Azure "
        f"(folder: {folder}) or local ({local_path})"
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_templates(force_refresh: bool = False) -> list[str]:
    """
    Return all available template names (Excel filenames without extension).
    Checks Azure first, falls back to local backend/data/excel/ folder.
    Results are cached for schema_cache_ttl_seconds.
    """
    from app.core.config import settings

    now = time.time()
    ttl = settings.schema_cache_ttl_seconds

    if (
        not force_refresh
        and _list_cache["data"] is not None
        and (now - _list_cache["fetched_at"]) < ttl
    ):
        return _list_cache["data"]

    templates: list[str] = []
    conn_str = settings.azure_storage_connection_string
    container = settings.azure_blob_container_name
    folder = settings.azure_excel_folder.rstrip("/")

    if conn_str:
        try:
            from azure.storage.blob import BlobServiceClient
            client = BlobServiceClient.from_connection_string(conn_str)
            cc = client.get_container_client(container)
            prefix = f"{folder}/"
            for blob in cc.list_blobs(name_starts_with=prefix):
                name = blob.name[len(prefix):]
                if name.lower().endswith(".xlsx") and "/" not in name:
                    templates.append(name[:-5])
            logger.info("Azure template list (%d): %s", len(templates), templates)
        except Exception as e:
            logger.warning("Azure template listing failed: %s", str(e))

    if not templates and os.path.isdir(_LOCAL_EXCEL_DIR):
        for fname in sorted(os.listdir(_LOCAL_EXCEL_DIR)):
            if fname.lower().endswith(".xlsx"):
                templates.append(fname[:-5])
        logger.info("Local template list (%d): %s", len(templates), templates)

    templates.sort()
    _list_cache["data"] = templates
    _list_cache["fetched_at"] = now
    return templates


def get_template_fields(template_name: str, force_refresh: bool = False) -> dict:
    """
    Return field definitions for a template, enriched with JSON DB values.

    Returns:
        {
            "template_name": "...",
            "fields": [
                {field_name, label, field_type, placeholder, required, readonly, order,
                 default_value (text/date/number) or options (dropdown)}
            ]
        }

    Raises:
        FileNotFoundError if the template Excel is not found.
        ValueError if the Excel cannot be parsed.
    """
    from app.core.config import settings

    now = time.time()
    ttl = settings.schema_cache_ttl_seconds
    cached = _fields_cache.get(template_name)

    if (
        not force_refresh
        and cached is not None
        and (now - cached["fetched_at"]) < ttl
    ):
        return cached["data"]

    raw = _fetch_excel_bytes(template_name)
    fields = _parse_excel_bytes(raw, template_name)
    db = _read_json_db(force_refresh=force_refresh)
    enriched = _enrich_with_db(fields, db)

    result = {"template_name": template_name, "fields": enriched}
    _fields_cache[template_name] = {"data": result, "fetched_at": now}
    logger.info("Template '%s' loaded: %d fields", template_name, len(enriched))
    return result


def invalidate_cache(template_name: str | None = None) -> None:
    """Force cache expiry. Pass None to clear everything (list + fields + db)."""
    if template_name is None:
        _list_cache["data"] = None
        _fields_cache.clear()
        _db_cache["data"] = None
    else:
        _fields_cache.pop(template_name, None)
        _db_cache["data"] = None  # always refresh DB when a specific template is refreshed
