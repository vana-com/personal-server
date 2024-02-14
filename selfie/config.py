import os
from typing import Optional

from pydantic import BaseModel, Field, ValidationError, Extra
import logging

logger = logging.getLogger(__name__)

default_port = 8181


class AppConfig(BaseModel):
    host: str = Field(default="http://localhost", description="Specify the host, with the scheme")
    port: Optional[int] = Field(default=default_port, description="Specify the port to run on")
    share: bool = Field(default=False, description="Enable sharing via ngrok")
    gpu: bool = Field(default=False, description="Enable GPU support")
    verbose: bool = Field(default=False, description="Enable verbose logging")
    database_storage_root: str = Field(default=os.path.join(os.path.dirname(os.path.realpath(__file__)), "../data/database"), description="Root directory for database storage")
    embeddings_storage_root: str = Field(default=os.path.join(os.path.dirname(os.path.realpath(__file__)), "../data/embeddings"), description="Root directory for embeddings storage")
    db_name: str = Field(default='selfie.db', description="Database name")
    # local_model: str = Field(default='TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF/mixtral-8x7b-instruct-v0.1.Q4_K_M.gguf', description="Local model")
    local_model: str = Field(default='TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q4_K_M.gguf', description="Local model")
    local_gpu_model: str = Field(default='TheBloke/Mistral-7B-OpenOrca-GPTQ', description="Local GPU model")
    local_functionary_model: str = Field(default="meetkai/functionary-7b-v2-GGUF/functionary-7b-v2.q4_0.gguf", description="Local functionary model")
    hosted_model: str = Field(default="openai/gpt-3.5-turbo", description="Hosted model")

    @property
    def base_url(self):
        if self.port:
            return f"{self.host}:{self.port}"
        else:
            return self.host

    class Config:
        extra = Extra.allow


_singleton_instance = None


def create_app_config(**kwargs):
    global _singleton_instance
    try:
        logger.debug("Creating AppConfig instance")
        _singleton_instance = AppConfig(**kwargs)
        return _singleton_instance
    except ValidationError as e:
        logger.error("Configuration validation error:", e.json())
        raise ValueError("Invalid configuration provided.") from e


def get_app_config():
    global _singleton_instance
    if _singleton_instance is None:
        logger.error("AppConfig instance not created yet.")
        raise ValueError("AppConfig instance not created yet.")
    return _singleton_instance
