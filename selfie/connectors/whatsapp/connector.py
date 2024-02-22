from abc import ABC
from typing import Any, List
import base64
from io import BytesIO

from selfie.connectors.base_connector import BaseConnector
from selfie.database import BaseModel
from selfie.embeddings import EmbeddingDocumentModel, DataIndex
from selfie.parsers.chat import ChatFileParser
from selfie.types.documents import DocumentDTO


class WhatsAppConfiguration(BaseModel):
    files: List[str]


def data_uri_to_string(data_uri):
    metadata, encoded = data_uri.split(',', 1)
    data = base64.b64decode(encoded)
    mime_type = metadata.split(';')[0].split(':')[1]
    with BytesIO(data) as buffer:
        content = buffer.read()
        string_content = content.decode('utf-8')
        return string_content


class WhatsAppConnector(BaseConnector, ABC):
    def __init__(self):
        super().__init__()
        self.id = "whatsapp"
        self.name = "WhatsApp"

    def load_document(self, configuration: dict[str, Any]) -> List[DocumentDTO]:
        config = WhatsAppConfiguration(**configuration)

        return [
            DocumentDTO(
                content=data_uri_to_string(data_uri),
                content_type="text/plain",
                name="todo",
                size=len(data_uri_to_string(data_uri).encode('utf-8'))
            )
            for data_uri in config.files
        ]

    def validate_configuration(self, configuration: dict[str, Any]):
        # TODO: check if file can be read from path
        pass

    def transform_for_embedding(self, configuration: dict[str, Any], documents: List[DocumentDTO]) -> List[EmbeddingDocumentModel]:
        return [
            embeddingDocumentModel
            for document in documents
            for embeddingDocumentModel in DataIndex.map_share_gpt_data(
                ChatFileParser().parse_document(
                    document=document.content,
                    parser_type="whatsapp",
                    mask=False,
                    document_name=document.name,
                ).conversations,
                source="whatsapp",
                source_document_id=document.id
            )
        ]
