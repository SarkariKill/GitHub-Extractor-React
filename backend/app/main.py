import logging
import os
import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes.health import router as health_router
from app.api.routes.shipper import router as shipper_router
from app.api.routes.template_schema import router as schema_router
from app.api.routes.generated_files import router as generated_files_router
from app.core.config import settings
from app.models.schemas import ErrorResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stdout,
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Shipper Label Generator API",
    version="1.0.0",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
    openapi_url="/api/v1/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled exception: %s", str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            success=False,
            detail="An unexpected server error occurred",
            error_code="INTERNAL_SERVER_ERROR",
        ).model_dump(),
    )


app.include_router(health_router, prefix="/api/v1")
app.include_router(shipper_router, prefix="/api/v1")
app.include_router(schema_router, prefix="/api/v1")
app.include_router(generated_files_router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health_check() -> dict:
    return {"status": "healthy"}


_STATIC_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),  # backend/app/
    "..",                                          # backend/
    "..",                                          # workspace root
    "artifacts", "frontend", "dist", "public",
))

if os.path.isdir(_STATIC_DIR):
    _assets_dir = os.path.join(_STATIC_DIR, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        candidate = os.path.join(_STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_STATIC_DIR, "index.html"))
else:
    @app.get("/{full_path:path}")
    async def spa_not_built(full_path: str) -> JSONResponse:
        return JSONResponse({"detail": "Frontend not built yet"}, status_code=503)
