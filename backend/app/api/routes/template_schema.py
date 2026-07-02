import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/templates/list")
async def list_templates_endpoint(
    refresh: bool = Query(False, description="Force cache refresh"),
) -> JSONResponse:
    """
    Return all available template names read from the configured Azure Blob
    excel folder (or the local backend/data/excel/ fallback).

    Each name is the Excel filename without the .xlsx extension.
    """
    from app.services.excel_schema import list_templates

    try:
        templates = list_templates(force_refresh=refresh)
    except Exception as e:
        logger.error("Failed to list templates: %s", str(e))
        raise HTTPException(status_code=503, detail=f"Could not list templates: {str(e)}")

    if not templates:
        logger.warning("No template Excel files found in Azure or local folder")

    return JSONResponse(content={"templates": templates})


@router.get("/templates/fields")
async def get_template_fields_endpoint(
    template: str = Query(..., description="Template name (Excel filename without .xlsx)"),
    refresh: bool = Query(False, description="Force cache refresh"),
) -> JSONResponse:
    """
    Return the field definitions for the given template, enriched with
    default values and dropdown options from template_values.json.
    """
    from app.services.excel_schema import get_template_fields

    if not template or not template.strip():
        raise HTTPException(status_code=400, detail="template parameter is required")

    template = template.strip()

    try:
        result = get_template_fields(template, force_refresh=refresh)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Failed to load template '%s': %s", template, str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Could not load template '{template}': {str(e)}",
        )

    return JSONResponse(content=result)
