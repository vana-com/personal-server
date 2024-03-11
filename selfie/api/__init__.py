import logging
import os
import sys

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware

from selfie.api.completions import router as completions_router
from selfie.api.connectors import router as connectors_router
from selfie.api.data_sources import router as data_sources_router
from selfie.api.document_connections import router as document_connections_router
from selfie.api.documents import router as documents_router
from selfie.api.index_documents import router as index_documents_router
from selfie.api.models import router as models_router
from selfie.api.connectors import router as connectors_router
from selfie.config import get_app_config

logger = logging.getLogger(__name__)

config = get_app_config()


description = """
The Selfie API is a RESTful API for interacting with the Selfie platform. It provides endpoints for generating chat and text completions, configuring and managing Selfie, and managing data sources, documents, and data indexing.
"""

tags_metadata = [
    {
        "name": "Completions",
        "description": """Endpoints for generating chat and text completions. Selfie completion endpoints can be used as drop-in replacements for endpoints in the [OpenAI API](https://platform.openai.com/docs/api-reference).

These endpoints generally include additional functionality not present in the OpenAI API, e.g. you can use a flag to control whether or not to Selfie data is used during text generation.

Please see the [API Usage Guide](https://github.com/vana-com/selfie/?tab=readme-ov-file#api-usage-guide) for more information on how to use these endpoints.
""",
    },
    {
        "name": "Search",
        "description": "Endpoints for searching and analyzing documents.",
    },
    {
        "name": "Data Management",
        "description": """Endpoints for managing data sources, documents, and data indexing.
   
These endpoints are primarily intended to be used by the Selfie UI."""
    },
    {
        "name": "Configuration",
        "description": """Endpoints for configuring and managing Selfie.

These endpoints are primarily intended to be used by the Selfie UI."""
    },
    {
        "name": "Deprecated",
        "description": "Endpoints that are deprecated and should not be used.",
    }

]


app = FastAPI(
    title="Selfie",
    description=description,
    root_path="/v1",
    openapi_tags=tags_metadata,
    version="0.1.0",  # TODO: dynamically fetch version
)

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

app.include_router(completions_router)
app.include_router(connectors_router)
app.include_router(document_connections_router)
app.include_router(data_sources_router)
app.include_router(documents_router)
app.include_router(index_documents_router)
app.include_router(models_router)
app.include_router(connectors_router)


class CleanURLMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        full_path = request.url.path
        # API and documentation routes do not need to be served as static files, skip them.
        if not full_path.startswith("/api/v1") and not full_path.startswith("/docs"):
            possible_path = os.path.join(static_files_dir, full_path.lstrip("/"))
            html_path = f"{possible_path}.html"
            if os.path.isfile(html_path):
                return FileResponse(html_path)
            elif os.path.isfile(possible_path):
                return FileResponse(possible_path)
        return await call_next(request)


app.add_middleware(CleanURLMiddleware)


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def serve_index_html():
    return FileResponse(os.path.join(static_files_dir, "index.html"))
