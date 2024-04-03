from os import environ
import os
import platform
from typing import Optional

from pydantic import BaseModel, Field, Extra
import logging

logger = logging.getLogger(__name__)

default_port = int(os.getenv('API_PORT', 8181))  # TODO: Not sure if this is persisted across processes, etc.

_singleton_instance = None

default_method = 'llama.cpp'
default_local_model = 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q4_K_M.gguf'
default_hosted_model = 'openai/gpt-3.5-turbo'
default_local_gpu_model = 'TheBloke/Mistral-7B-OpenOrca-GPTQ'

ensure_set_in_db = ['gpu', 'method', 'model', 'verbose_logging']


# TODO: This is not accurate, e.g. if the user starts the app with --gpu
def get_default_gpu_mode():
    os_name = platform.system()
    architecture = platform.machine()

    if os_name == 'Darwin' and architecture == 'arm64':
        return True

    return False


class AppConfig(BaseModel):
    host: str = Field(default="http://localhost", description="Specify the host, with the scheme")
    api_port: Optional[int] = Field(default=default_port, description="Specify the port to run on")
    share: bool = Field(default=False, description="Enable sharing via ngrok")
    gpu: bool = Field(default=get_default_gpu_mode(), description="Enable GPU support")
    verbose_logging: bool = Field(default=False, description="Enable verbose logging")
    db_name: str = Field(default='selfie.db', description="Database name")
    method: str = Field(default=default_method, description="LLM provider method, llama.cpp or litellm")
    model: str = Field(default=default_local_model, description="Local model")
    api_base: Optional[str] = Field(default=None, description="Specify an optional litellm API base URL")
    local_functionary_model: str = Field(default="meetkai/functionary-7b-v2-GGUF/functionary-7b-v2.q4_0.gguf", description="Local functionary model")
    embedding_chunk_size: int = Field(default=512, description="Embedding chunk size")
    embedding_chunk_overlap: int = Field(default=50, description="Embedding chunk overlap")
    environment_variables: dict = Field(default={}, description="Environment variables to load, used by e.g. litellm")
    ngrok_enabled: bool = Field(default=False, description="Enable ngrok")
    ngrok_authtoken: Optional[str] = Field(default=None, description="ngrok authentication token")
    ngrok_domain: Optional[str] = Field(default=None, description="ngrok domain")

    _runtime_overrides: dict = {}

    @property
    def base_url(self):
        if self.api_port:
            return f"{self.host}:{self.api_port}"
        else:
            return self.host

    class Config:
        extra = Extra.allow

    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        if name == "environment_variables":
            self.load_environment_variables()

    def load_environment_variables(self):
        for key, value in self.environment_variables.items():
            environ[key] = str(value)
        logger.info("Environment variables loaded or updated.")

    @classmethod
    def reload(cls):
        global _singleton_instance
        if _singleton_instance is None:
            raise ValueError("AppConfig instance not created yet.")

        # Capture current environment variables before update
        current_env_vars = set(_singleton_instance.environment_variables.keys())

        # Load new configuration values, e.g., from a database or another source
        db_config = AppConfig(**load_config_from_database())

        # Merge configurations: default < database < CLI options
        config_dict = cls().dict()
        config_dict.update(db_config.dict(exclude_unset=True))
        config_dict.update(_singleton_instance._runtime_overrides)

        # Determine environment variables that are going away
        new_env_vars = set(config_dict.get("environment_variables", {}).keys())
        vars_to_remove = current_env_vars - new_env_vars

        # Remove environment variables that are no longer present
        for var in vars_to_remove:
            if var in os.environ:
                del os.environ[var]
                logger.info(f"Removed environment variable: {var}")

        # Instead of creating a new instance, update the existing one
        logger.info(f"Reloading AppConfig with: {config_dict}")
        for key, value in config_dict.items():
            setattr(_singleton_instance, key, value)

        # Load (or reload) the environment variables based on the new configuration
        _singleton_instance.load_environment_variables()

        return _singleton_instance


def create_app_config(**kwargs):
    default_config = AppConfig()
    db_config = load_config_from_database()
    loaded_db_config = AppConfig(**db_config)

    # Merge configurations: default < database
    config_dict = default_config.dict()
    config_dict.update(loaded_db_config.dict(exclude_unset=True))

    # Update the merged configuration with explicitly provided CLI options
    runtime_overrides = {}
    for key, value in kwargs.items():
        if value is not None:
            config_dict[key] = value
            runtime_overrides[key] = value

    for field in ensure_set_in_db:
        updates = {}
        if field not in db_config or db_config[field] is None:
            logger.info(f"No saved setting for {field}, saving {config_dict[field]}")
            updates[field] = config_dict[field]
        if updates:
            update_config_in_database(updates)

    global _singleton_instance
    logger.info(f"Creating AppConfig with: {config_dict}")
    _singleton_instance = AppConfig(**config_dict)
    _singleton_instance._runtime_overrides = runtime_overrides

    _singleton_instance.load_environment_variables()
    return _singleton_instance


def load_config_from_database():
    from selfie.database import DataManager
    return DataManager().get_settings()


def update_config_in_database(settings, delete_others=False):
    from selfie.database import DataManager
    DataManager().save_settings(settings, delete_others=delete_others)


def get_app_config():
    global _singleton_instance
    if _singleton_instance is None:
        raise ValueError("AppConfig instance not created yet.")
    return _singleton_instance

