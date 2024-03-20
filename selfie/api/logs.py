import os

from fastapi import APIRouter

from selfie.logging import get_log_path

router = APIRouter(tags=["Configuration"])


@router.get("/logs")
async def get_logs():
    try:
        filepath = get_log_path()
        file_stats = os.stat(filepath)
        with open(filepath, "r") as file:
            log = file.read()
            return [{
                "filename": filepath.split("/")[-1],
                "log": log,
                "size": file_stats.st_size,
                "lines": len(log.split("\n")),
                "last_modified": file_stats.st_mtime  # Use the result of os.stat()
            }]
    except FileNotFoundError:
        return [], 404
