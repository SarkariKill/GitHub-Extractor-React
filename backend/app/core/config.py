import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    azure_storage_connection_string: str = ""
    azure_blob_container_name: str = "uploaded-files"
    azure_blob_target_folder: str = "input"
    cors_origins: str = "*"
    max_file_size_mb: int = 50
    azure_excel_folder: str = "excel"
    azure_config_folder: str = "config"
    schema_cache_ttl_seconds: int = 300  # 5-minute cache

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    @property
    def cors_origins_list(self) -> list[str]:
        if self.cors_origins == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
