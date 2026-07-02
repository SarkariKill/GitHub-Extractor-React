from pydantic import BaseModel, ConfigDict, field_validator


DISTRIBUTED_BY = (
    "Distributed by:\n"
    "Kenvue Brands LLC\n"
    "Summit, NJ 07901\n\n"
    "© Kenvue Brands LLC 2026"
)


class MissingField(BaseModel):
    field: str
    label: str


class ShipperData(BaseModel):
    product_name: str
    gtin: str
    quantity: str
    inner_pack: str
    material_number: str
    label_specification: str
    storage_requirements: str | None = None
    batch_number: str | None = None
    expiration_date: str | None = None
    active_ingredient: str | None = None
    distributed_by: str = DISTRIBUTED_BY
    country_of_origin_active: str = "N/A"
    special_requirements: str = "N/A"


class ShipperDataInput(BaseModel):
    """Legacy fixed-field input — kept for backward compatibility."""
    template: str = "1"
    product_name: str
    gtin: str
    quantity: str
    inner_pack: str
    material_number: str
    label_specification: str = ""
    storage_requirements: str = ""
    batch_number: str = ""
    expiration_date: str = ""
    active_ingredient: str = ""
    country_of_origin_active: str = "N/A"
    special_requirements: str = "N/A"

    @field_validator("material_number")
    @classmethod
    def sanitize_material_number(cls, v: str) -> str:
        import re
        sanitized = re.sub(r"[^a-zA-Z0-9_\-]", "", v)
        if not sanitized:
            raise ValueError("material_number contains no valid characters")
        return sanitized

    @field_validator("batch_number")
    @classmethod
    def sanitize_batch_number(cls, v: str) -> str:
        import re
        return re.sub(r"[^a-zA-Z0-9_\-]", "", v)


class DynamicShipperInput(BaseModel):
    """
    Flexible input for dynamic template generation.
    Accepts any field submitted by the frontend alongside the required
    template name and routing fields.
    """
    model_config = ConfigDict(extra="allow")

    template: str
    material_number: str = "unknown"
    batch_number: str = "unknown"


class ExtractResponse(BaseModel):
    success: bool
    data: ShipperData
    missing_fields: list[MissingField] = []


class GenerateResponse(BaseModel):
    success: bool
    message: str
    document_id: str
    file_name: str
    blob_path: str
    download_url: str


class FileListResponse(BaseModel):
    success: bool
    files: list[str]
    total: int
    start_date: str
    end_date: str


class ErrorResponse(BaseModel):
    success: bool = False
    detail: str
    error_code: str
