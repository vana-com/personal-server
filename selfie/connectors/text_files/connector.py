from abc import ABC
from typing import Any, List

from selfie.config import get_app_config


from llama_index.core.node_parser import SentenceSplitter

from selfie.connectors.base_connector import BaseConnector
from selfie.database import BaseModel, DataManager
from selfie.embeddings import EmbeddingDocumentModel
from selfie.types.documents import DocumentDTO
from selfie.utils import data_uri_to_dict

config = get_app_config()


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
                content=(parsed := data_uri_to_dict(data_uri))['content'],
                content_type=parsed['content_type'],
                name=parsed['name'],
                size=len(parsed['content'].encode('utf-8'))
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
            for text_chunk in SentenceSplitter(
                chunk_size=config.embedding_chunk_size,
                chunk_overlap=config.embedding_chunk_overlap,
            ).split_text(document.content)
        ]
