from abc import ABC
from typing import Any, List

from selfie.connectors.base_connector import BaseConnector
from selfie.database import BaseModel
from selfie.embeddings import EmbeddingDocumentModel, DataIndex
from selfie.parsers.chat import ChatFileParser  # TODO Replace this with ChatGPTParser
from selfie.types.documents import DocumentDTO
from selfie.utils import data_uri_to_string


class ChatGPTConfiguration(BaseModel):
    files: List[str]


class ChatGPTConnector(BaseConnector, ABC):
    def __init__(self):
        super().__init__()
        self.id = "chatgpt"
        self.name = "ChatGPT"

    def load_document(self, configuration: dict[str, Any]) -> List[DocumentDTO]:
        config = ChatGPTConfiguration(**configuration)

        return [
            DocumentDTO(
                content=(content := data_uri_to_string(data_uri)),
                content_type="application/json",
                name="todo",
                size=len(content.encode('utf-8'))
            )
            for data_uri in config.files
        ]

    def validate_configuration(self, configuration: dict[str, Any]):
        # TODO: check if file can be read from path
        pass

    def transform_for_embedding(self, configuration: dict[str, Any], documents: List[DocumentDTO]) -> List[
        EmbeddingDocumentModel]:
        return [
            embeddingDocumentModel
            for document in documents
            for embeddingDocumentModel in DataIndex.map_share_gpt_data(
                ChatFileParser().parse_document(
                    document=document.content,
                    parser_type="chatgpt",
                    mask=False,
                    document_name=document.name,
                ).conversations,
                source="chatgpt",
                source_document_id=document.id
            )
        ]
