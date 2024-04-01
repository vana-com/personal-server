# TODO: This is an *incomplete* migration of functionality from __init__.py,
# which should not contain any database operations, only initialization. All
# operations should be contained in this service (maybe in a class).

import importlib
import json
from typing import Callable, List, Dict, Any
import logging

from selfie.embeddings import EmbeddingDocumentModel
from selfie.database import DocumentModel, DocumentConnectionModel
from selfie.embeddings import DataIndex
from selfie.utils.models import map_selfie_documents_to_index_documents
from selfie.types.documents import DocumentDTO

logger = logging.getLogger(__name__)


async def remove_document_connection(data_manager, document_connection_id: int, delete_documents: bool = True,
                                     delete_indexed_data: bool = True):
    if data_manager.get_document_connection(document_connection_id) is None:
        raise ValueError(f"No document connection found with ID {document_connection_id}")

    if delete_indexed_data:
        source_document_ids = [doc.id for doc in DocumentModel.select().where(
            DocumentModel.document_connection == document_connection_id)]
        await DataIndex("n/a").delete_documents_with_source_documents(source_document_ids)

    with data_manager.db.atomic():
        if delete_documents:
            DocumentModel.delete().where(DocumentModel.document_connection == document_connection_id).execute()

        DocumentConnectionModel.delete().where(DocumentConnectionModel.id == document_connection_id).execute()


async def index_documents(data_manager, document_connection: DocumentConnectionModel):
    print("Indexing documents")

    scan_document_connections(data_manager, [document_connection.id])

    documents = fetch_documents(data_manager, json.loads(document_connection.configuration))
    documents = [
        document for doc in documents for document in
        doc.map_to_index_documents()
    ]

    await DataIndex("n/a").index(documents, extract_importance=False)

    # TODO: record the last time this data source was indexed

    return {"message": f"{len(documents)} documents indexed successfully"}


async def index_document(data_manager, document: DocumentDTO, selfie_documents_to_index_documents: Callable[
    [DocumentDTO], List[EmbeddingDocumentModel]] = None):
    print("Indexing document")

    if selfie_documents_to_index_documents is None:
        index_documents = document.map_to_index_documents()
    else:
        index_documents = selfie_documents_to_index_documents(document)

    if not index_documents:
        logger.warning("No documents to index")
        return {"message": "No documents to index"}

    return await DataIndex("n/a").index(index_documents, extract_importance=False)


async def remove_documents(data_manager, document_ids: List[int], delete_indexed_data: bool = True):
    if delete_indexed_data:
        await DataIndex("n/a").delete_documents_with_source_documents(document_ids)

    try:
        with data_manager.db.atomic():
            DocumentModel.delete().where(DocumentModel.id.in_(document_ids)).execute()
    except Exception as e:
        logger.error(f"Error removing documents, but indexed data was removed: {e}")
        raise e


async def remove_document(data_manager, document_id: int, delete_indexed_data: bool = True):
    return await remove_documents(data_manager, [document_id], delete_indexed_data)


def fetch_documents(data_manager, configuration: Dict[str, Any]) -> List[DocumentDTO]:
    # TODO: Replace this with DocumentConnector implementation. Maybe it shouldn't return Peewee models directly.
    module_name, class_name = configuration["loader_name"].rsplit(".", 1)
    module = importlib.import_module(module_name)
    loader_class = getattr(module, class_name)
    loader = loader_class(
        *configuration["constructor_args"], **configuration["constructor_kwargs"]
    )
    loader_docs = loader.load_data(*configuration["load_data_args"], **configuration["load_data_kwargs"])
    return [
        DocumentDTO(
            content=doc.text,
            content_type="text",
            name="N/A",
            size=0
        )
        for doc in loader_docs
    ]


def scan_document_connections(data_manager, connection_ids: List[int]) -> Dict[str, Any]:
    changes = {}
    for connection_id in connection_ids:
        document_connection = DocumentConnectionModel.get_by_id(connection_id)

        connection_config = json.loads(document_connection.configuration)
        if connection_config["loader_name"].startswith("selfie"):
            # TODO: last_loaded_timestamp is not currently defined
            connection_config["load_data_kwargs"]["earliest_date"] = document_connection.last_loaded_timestamp

        documents = fetch_documents(data_manager, connection_config)
        for doc in documents:
            document, created = DocumentModel.get_or_create(
                document_connection=document_connection,
                content=doc.content,  # TODO: This, if doc.content_type matches text, otherwise key should be object
                defaults={
                    "content_type": doc.content_type,
                    "name": doc.name,
                    "size": doc.size,
                },
            )
            changes[document.id] = "Created" if created else "Updated"
    return changes
