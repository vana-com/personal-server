import os
import sys

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
import logging

from selfie.api.completions import router as completions_router
from selfie.api.data_sources import router as data_sources_router
from selfie.api.documents import router as documents_router
from selfie.api.index_documents import router as index_documents_router
from selfie.api.models import router as models_router

logger = logging.getLogger(__name__)


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_headers=["*"],
    allow_methods=["*"],
    allow_origins=["*"],
)

if getattr(sys, 'frozen', False):
    # Running in a PyInstaller bundle
    bundle_dir = os.path.join(
        sys._MEIPASS, "selfie"
    )
else:
    # Running in a normal Python environment
    bundle_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

static_files_dir = os.path.join(bundle_dir, "web")


app.mount("/static", StaticFiles(directory=static_files_dir), name="static")


app.include_router(completions_router, prefix="/v1")
app.include_router(data_sources_router, prefix="/v1")
app.include_router(documents_router, prefix="/v1")
app.include_router(index_documents_router, prefix="/v1")
app.include_router(models_router, prefix="/v1")


@app.get("/", response_class=HTMLResponse)
async def serve_index_html():
    index_html_path = os.path.join(static_files_dir, "index.html")
    with open(index_html_path, "r") as f:
        return HTMLResponse(content=f.read())


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa_or_static(request: Request, full_path: str):
    # Skip API routes
    if full_path.startswith("api/v1") or full_path.startswith("docs"):
        return

    possible_path = os.path.join(static_files_dir, full_path)
    if os.path.isfile(possible_path):
        # Serve matching file
        return FileResponse(possible_path)
    else:
        # Serve the app
        return FileResponse(os.path.join(static_files_dir, "index.html"))
