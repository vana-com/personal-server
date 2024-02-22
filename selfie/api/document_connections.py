from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from starlette import status

from selfie.connectors.factory import ConnectorFactory
from selfie.database import DataManager, DocumentModel
from selfie.embeddings import DataIndex

router = APIRouter()


class DocumentConnectionRequest(BaseModel):
    connector_id: str
    configuration: Any


@router.post("/document-connections", status_code=status.HTTP_201_CREATED)
async def create_document_connection(request: DocumentConnectionRequest):
    connector_instance = ConnectorFactory.get_connector(connector_name=request.connector_id)
    connector_instance.validate_configuration(configuration=request.configuration)
    document_dtos = connector_instance.load_document(request.configuration)

    if len(document_dtos) > 0:
        # Save document connection
        document_connection = DataManager().add_document_connection(
            request.connector_id,
            request.configuration
        )
        # Save documents
        for document_dto in document_dtos:
            document_model = DocumentModel.create(
                document_connection=document_connection,
                content=document_dto.content,
                content_type=document_dto.content_type,
                name=document_dto.name,
                size=document_dto.size
            )
            document_dto.id = document_model.id
            document_dto.document_connection_id = document_connection

        embedding_documents = connector_instance.transform_for_embedding(request.configuration, document_dtos)
        # Save embedding_documents to Vector DB
        await DataIndex("n/a").index(embedding_documents, extract_importance=False)
