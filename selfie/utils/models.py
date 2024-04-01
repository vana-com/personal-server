from datetime import datetime
from llama_index.core.node_parser import SentenceSplitter

from selfie.config import get_app_config
from selfie.embeddings import EmbeddingDocumentModel
from selfie.types.documents import DocumentDTO


def map_selfie_documents_to_index_documents(selfie_document: DocumentDTO):
    config = get_app_config()

    return [
        EmbeddingDocumentModel(
            text=text_chunk,
            # source=selfie_document.document_connection.connector_name,
            source="Unknown",
            timestamp=selfie_document.extract_timestamp(),
            source_document_id=selfie_document.id,
        )
        for text_chunk in SentenceSplitter(
            chunk_size=config.embedding_chunks_size,
            chunk_overlap=config.embedding_chunk_overlap
        ).split_text(selfie_document.content)
    ]


def extract_timestamp(doc: DocumentDTO):
    return doc.created_at if doc.created_at else datetime.now()
