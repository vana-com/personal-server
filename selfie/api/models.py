from datetime import datetime
from fastapi import APIRouter
from huggingface_hub import scan_cache_dir
from typing import List, Optional
from pydantic import BaseModel, Field

router = APIRouter(tags=["Configuration"])


class Model(BaseModel):
    id: str = Field(..., description="The unique identifier of the model, formatted as 'repo_id/filename'")
    object: str = Field(..., description="The type of the object, typically 'model'")
    created: datetime = Field(..., description="The timestamp when the model was last modified in the cache")
    owned_by: str = Field(..., description="Indicates the ownership of the model, typically 'user' for user-uploaded models")


class ModelsResponse(BaseModel):
    object: str = Field(..., description="The type of the response, always 'list'")
    data: List[Model] = Field(..., description="A list of model objects detailing available models in the cache")

    model_config = {
        "json_schema_extra": {
            "example": {
                "object": "list",
                "data": [
                    {
                        "id": "user/repo/modelname.gguf",
                        "object": "model",
                        "created": "2021-01-01T00:00:00Z",
                        "owned_by": "user"
                    }
                ]
            }
        }
    }


@router.get("/models",
            description="Retrieve a list of **already-downloaded llama.cpp models** (in the Hugging Face Hub cache). This endpoint scans the cache directory for model files (specifically looking for files with a '.gguf' extension within each repository revision) and returns a list of models including their ID, object type, creation timestamp, and ownership information.")
async def get_models() -> ModelsResponse:
    hf_cache_info = scan_cache_dir()
    models = []

    for repo in hf_cache_info.repos:
        for revision in repo.revisions:
            gguf_files = [file for file in revision.files if file.file_name.endswith('.gguf')]
            if gguf_files:
                for gguf_file in gguf_files:
                    models.append(Model(
                        id=f"{repo.repo_id}/{gguf_file.file_name}",
                        object="model",
                        created=gguf_file.blob_last_modified,
                        owned_by="user"
                    ))
            else:
                models.append(Model(
                    id=repo.repo_id,
                    object="model",
                    created=min(file.last_modified for file in repo.revisions),
                    owned_by="user"
                ))

    return ModelsResponse(object="list", data=models)
