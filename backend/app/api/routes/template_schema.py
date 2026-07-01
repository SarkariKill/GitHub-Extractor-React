import logging

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/templates/schema")
async def get_schema(refresh: bool = Query(False, description="Force a cache refresh from Azure")) -> JSONResponse:
    """
    Return the dynamic template field schema loaded from the Azure Excel file.

    The schema is cached for `schema_cache_ttl_seconds` (default 5 min).
    Pass ?refresh=true to force an immediate reload from Azure.
    """
    from app.services.excel_schema import get_template_schema

    result = get_template_schema(force_refresh=refresh)
    return JSONResponse(content=result)
