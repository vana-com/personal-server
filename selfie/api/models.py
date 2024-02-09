from fastapi import APIRouter
from huggingface_hub import scan_cache_dir

router = APIRouter()


@router.get("/models")
async def get_models():
    hf_cache_info = scan_cache_dir()
    models = []

    for repo in hf_cache_info.repos:
        for revision in repo.revisions:
            gguf_files = [file for file in revision.files if file.file_name.endswith('.gguf')]
            if gguf_files:
                for gguf_file in gguf_files:
                    models.append({
                        "id": f"{repo.repo_id}/{gguf_file.file_name}",
                        "object": "model",
                        "created": gguf_file.blob_last_modified,
                        "owned_by": "user"
                    })
            else:
                models.append({
                    "id": repo.repo_id,
                    "object": "model",
                    "created": min(file.last_modified for file in repo.revisions),
                    "owned_by": "user"
                })

    return {
        "object": "list",
        "data": models
    }
