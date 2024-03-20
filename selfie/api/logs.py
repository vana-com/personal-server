import os

from fastapi import APIRouter

router = APIRouter(tags=["Configuration"])


@router.get("/logs")
async def get_logs():
    try:
        filepath = "selfie.log"
        file_stats = os.stat(filepath)
        with open(filepath, "r") as file:
            log = file.read()
            return [{
                "filename": "selfie.log",
                "log": log,
                "size": file_stats.st_size,
                "lines": len(log.split("\n")),
                "last_modified": file_stats.st_mtime  # Use the result of os.stat()
            }]
    except FileNotFoundError:
        return [], 404
