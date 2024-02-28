from abc import ABC
from typing import Any, List

from llama_index.core.node_parser import SentenceSplitter

from selfie.connectors.base_connector import BaseConnector
from selfie.database import BaseModel, DataManager
from selfie.embeddings import EmbeddingDocumentModel
from selfie.types.documents import DocumentDTO
from selfie.utils import data_uri_to_string


class TextFilesConfiguration(BaseModel):
    files: List[str]


class TextFilesConnector(BaseConnector, ABC):
    def __init__(self):
        super().__init__()
        self.id = "text_files"
        self.name = "Text Files"

    def load_document(self, configuration: dict[str, Any]) -> List[DocumentDTO]:
        config = TextFilesConfiguration(**configuration)

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
            EmbeddingDocumentModel(
                text=text_chunk,
                source="text_files",
                timestamp=DataManager._extract_timestamp(document),
                source_document_id=document.id,
            )
            for document in documents
            for text_chunk in SentenceSplitter(chunk_size=1024).split_text(document.content)
        ]
