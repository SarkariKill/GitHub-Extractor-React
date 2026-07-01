"""
Dynamic template schema service.

Reads an Excel file from Azure Blob Storage that defines the fields for each
template (label, type, placeholder, required, readonly, order).

The schema is cached in-memory for `schema_cache_ttl_seconds` (default 5 min)
so that changes to the Excel propagate to the UI within one cache cycle without
requiring a backend restart.

Excel format (row 1 = headers):
  template | field_key | label | field_type | placeholder | required | readonly | order

  - template:     "1" or "2"
  - field_key:    internal key matching ShipperData field names (e.g. "product_name")
  - label:        display label shown in the UI
  - field_type:   "text" | "date" | "number"
  - placeholder:  example / dummy value shown as input hint
  - required:     "yes" / "no"  (or TRUE/FALSE from Excel)
  - readonly:     "yes" / "no"
  - order:        integer — ascending display order within a template
"""
import io
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fallback schema (used when Azure is unavailable or blob not found)
# ---------------------------------------------------------------------------
_FALLBACK: dict[str, list[dict]] = {
    "1": [
        {"field_key": "product_name",        "label": "Product Name",                          "field_type": "text",   "placeholder": "e.g. Tylenol Extra Strength 500mg", "required": True,  "readonly": False, "order": 1},
        {"field_key": "gtin",                "label": "GTIN",                                  "field_type": "text",   "placeholder": "e.g. 00300450449684",               "required": True,  "readonly": False, "order": 2},
        {"field_key": "material_number",     "label": "Material Number",                       "field_type": "text",   "placeholder": "",                                  "required": True,  "readonly": True,  "order": 3},
        {"field_key": "quantity",            "label": "Quantity per Case",                     "field_type": "text",   "placeholder": "e.g. 24 EA",                        "required": True,  "readonly": False, "order": 4},
        {"field_key": "inner_pack",          "label": "Inner Pack",                            "field_type": "text",   "placeholder": "e.g. 6x4",                         "required": True,  "readonly": False, "order": 5},
        {"field_key": "label_specification", "label": "Label Specification",                   "field_type": "text",   "placeholder": "e.g. LS-2024-001",                 "required": True,  "readonly": False, "order": 6},
        {"field_key": "active_ingredient",   "label": "Active Ingredient",                     "field_type": "text",   "placeholder": "e.g. Acetaminophen 500mg",          "required": True,  "readonly": False, "order": 7},
        {"field_key": "storage_requirements","label": "Storage Requirements",                  "field_type": "text",   "placeholder": "e.g. Store below 25°C",             "required": True,  "readonly": False, "order": 8},
        {"field_key": "batch_number",        "label": "Batch Number",                          "field_type": "text",   "placeholder": "e.g. B20260101",                   "required": True,  "readonly": False, "order": 9},
        {"field_key": "expiration_date",     "label": "Expiration Date",                       "field_type": "text",   "placeholder": "e.g. 2028-01",                     "required": True,  "readonly": False, "order": 10},
        {"field_key": "distributed_by",      "label": "Distributed By",                        "field_type": "text",   "placeholder": "",                                  "required": False, "readonly": True,  "order": 11},
    ],
    "2": [
        {"field_key": "product_name",              "label": "Product Name, Description, and Size",       "field_type": "text", "placeholder": "e.g. Tylenol Extra Strength Caplets 500mg", "required": True,  "readonly": False, "order": 1},
        {"field_key": "quantity",                  "label": "Quantity per Case",                         "field_type": "text", "placeholder": "e.g. 24 EA",                                "required": True,  "readonly": False, "order": 2},
        {"field_key": "inner_pack",                "label": "Inner Pack",                                "field_type": "text", "placeholder": "e.g. 6x4",                                  "required": True,  "readonly": False, "order": 3},
        {"field_key": "material_number",           "label": "Product Code",                              "field_type": "text", "placeholder": "",                                           "required": True,  "readonly": True,  "order": 4},
        {"field_key": "gtin",                      "label": "Shipper GTIN Barcode and Human Readable",   "field_type": "text", "placeholder": "e.g. 10300450449681",                       "required": True,  "readonly": False, "order": 5},
        {"field_key": "batch_number",              "label": "Batch/Lot Code",                            "field_type": "text", "placeholder": "e.g. B20260101",                            "required": True,  "readonly": False, "order": 6},
        {"field_key": "expiration_date",           "label": "Expiration Date",                           "field_type": "text", "placeholder": "e.g. 2028-01",                              "required": True,  "readonly": False, "order": 7},
        {"field_key": "storage_requirements",      "label": "Storage Requirements",                      "field_type": "text", "placeholder": "e.g. Store below 25°C",                     "required": True,  "readonly": False, "order": 8},
        {"field_key": "distributed_by",            "label": "Distributed By",                            "field_type": "text", "placeholder": "",                                           "required": False, "readonly": True,  "order": 9},
        {"field_key": "country_of_origin_active",  "label": "Country of Origin of Active",              "field_type": "text", "placeholder": "N/A",                                        "required": False, "readonly": False, "order": 10},
        {"field_key": "special_requirements",      "label": "Special Requirements",                      "field_type": "text", "placeholder": "N/A",                                        "required": False, "readonly": False, "order": 11},
    ],
}

# ---------------------------------------------------------------------------
# In-memory TTL cache
# ---------------------------------------------------------------------------
_cache: dict[str, Any] = {
    "data": None,
    "fetched_at": 0.0,
    "source": "none",
}


def _bool_from_cell(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("yes", "true", "1", "y")
    return bool(value)


def _parse_excel(raw_bytes: bytes) -> dict[str, list[dict]]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise ValueError("Excel file is empty")

    headers = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
    required_cols = {"template", "field_key", "label"}
    missing = required_cols - set(headers)
    if missing:
        raise ValueError(f"Excel is missing required columns: {missing}")

    def col(row: tuple, name: str, default: Any = "") -> Any:
        try:
            idx = headers.index(name)
            v = row[idx]
            return v if v is not None else default
        except ValueError:
            return default

    schema: dict[str, list[dict]] = {}
    for row in rows[1:]:
        tmpl = str(col(row, "template", "")).strip()
        fkey = str(col(row, "field_key", "")).strip()
        label = str(col(row, "label", "")).strip()
        if not tmpl or not fkey or not label:
            continue

        schema.setdefault(tmpl, []).append({
            "field_key":   fkey,
            "label":       label,
            "field_type":  str(col(row, "field_type", "text")).strip().lower() or "text",
            "placeholder": str(col(row, "placeholder", "")).strip(),
            "required":    _bool_from_cell(col(row, "required", True)),
            "readonly":    _bool_from_cell(col(row, "readonly", False)),
            "order":       int(col(row, "order", 999)),
        })

    # Sort each template's fields by order
    for tmpl_fields in schema.values():
        tmpl_fields.sort(key=lambda f: f["order"])

    return schema


def _fetch_from_azure() -> tuple[dict[str, list[dict]], str]:
    """Download the Excel blob and parse it. Returns (schema, source_label)."""
    from app.core.config import settings

    conn_str = settings.azure_storage_connection_string
    container = settings.azure_blob_container_name
    blob_name = settings.azure_template_schema_blob

    if not conn_str:
        logger.info("Azure not configured — using fallback schema")
        return _FALLBACK, "fallback"

    try:
        from azure.storage.blob import BlobServiceClient

        client = BlobServiceClient.from_connection_string(conn_str)
        blob_client = client.get_blob_client(container=container, blob=blob_name)
        raw = blob_client.download_blob().readall()
        schema = _parse_excel(raw)
        logger.info("Template schema loaded from Azure blob: %s", blob_name)
        return schema, "azure"
    except Exception as e:
        logger.warning("Could not load schema from Azure (%s) — using fallback", str(e))
        return _FALLBACK, "fallback"


def get_template_schema(force_refresh: bool = False) -> dict:
    """
    Return the cached template schema, refreshing from Azure if the TTL has expired.

    Returns:
        {
            "templates": {"1": [...fields...], "2": [...fields...]},
            "source": "azure" | "fallback",
            "cached_at": <unix timestamp>,
        }
    """
    from app.core.config import settings

    now = time.time()
    ttl = settings.schema_cache_ttl_seconds

    if force_refresh or _cache["data"] is None or (now - _cache["fetched_at"]) > ttl:
        schema, source = _fetch_from_azure()
        _cache["data"] = schema
        _cache["fetched_at"] = now
        _cache["source"] = source
        logger.info("Schema cache refreshed (source=%s)", source)

    return {
        "templates": _cache["data"],
        "source": _cache["source"],
        "cached_at": _cache["fetched_at"],
    }
