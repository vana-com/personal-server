from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from starlette import status

from selfie.connectors.factory import ConnectorFactory

router = APIRouter()


class DocumentConnectionRequest(BaseModel):
    connector_id: str
    configuration: Any


@router.post("/document-connections", status_code=status.HTTP_201_CREATED)
async def create_document_connection(request: DocumentConnectionRequest):
    connector_instance = ConnectorFactory.get_connector(connector_name=request.connector_id)
    selfie_documents = connector_instance.load_document(request.configuration)
    # TODO: save selfie_documents to SQLite
    embedding_documents = connector_instance.transform_for_embedding(request.configuration, selfie_documents)
    # TODO: save embedding_documents to Vector DB
