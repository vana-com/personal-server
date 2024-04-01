from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime
from llama_index.core.node_parser import SentenceSplitter
from selfie.config import get_app_config
from selfie.embeddings import EmbeddingDocumentModel


class BaseDTO(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class DocumentDTO(BaseDTO):
    id: Optional[int] = None
    document_connection_id: Optional[int] = None
    content: str
    content_type: str
    name: str
    size: int

    def map_to_index_documents(self):
        config = get_app_config()

        return [
            EmbeddingDocumentModel(
                text=text_chunk,
                # source=selfie_document.document_connection.connector_name,
                source="Unknown",
                timestamp=self.extract_timestamp(),
                source_document_id=self.id,
            )
            for text_chunk in SentenceSplitter(
                chunk_size=config.embedding_chunks_size,
                chunk_overlap=config.embedding_chunk_overlap
            ).split_text(self.content)
        ]

    def extract_timestamp(self):
        return self.created_at if self.created_at else datetime.now()


class DocumentConnectionDTO(BaseDTO):
    id: Optional[int] = None
    connector_name: str
    configuration: Dict[str, Any]
