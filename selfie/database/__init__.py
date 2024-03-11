import importlib
import json
import logging
import os
from datetime import datetime
from typing import List, Dict, Any, Callable

from llama_index.core.node_parser import SentenceSplitter
from peewee import (
    Model,
    SqliteDatabase,
    CharField,
    TextField,
    ForeignKeyField,
    AutoField,
    Proxy,
    IntegerField,
    DateTimeField,
)
from playhouse.shortcuts import model_to_dict

from selfie.config import get_app_config
from selfie.embeddings import DataIndex
from selfie.embeddings.document_types import EmbeddingDocumentModel
# TODO: This module should not be aware of DocumentDTO. Refactor its usage out of this module.
from selfie.types.documents import DocumentDTO

logger = logging.getLogger(__name__)

database_proxy = Proxy()

config = get_app_config()


class BaseModel(Model):
    created_at = DateTimeField(default=datetime.now)
    updated_at = DateTimeField(default=datetime.now)

    def save(self, *args, **kwargs):
        self.updated_at = datetime.now()
        return super(BaseModel, self).save(*args, **kwargs)

    class Meta:
        database = database_proxy


# class DataSource(BaseModel):
#     id = AutoField()
#     name = CharField()
#     loader_module = CharField()
#     config = TextField()
#     last_loaded_timestamp = CharField(null=True)
#
#     class Meta:
#         table_name = 'selfie_datasource'
class DocumentConnectionModel(BaseModel):
    id = AutoField()
    #     name = CharField()
    connector_name = CharField()
    configuration = TextField()

    #     last_loaded_timestamp = CharField(null=True)

    class Meta:
        table_name = 'selfie_document_connection'


# class SelfieDocument(BaseModel):
#     id = AutoField()
#     source = ForeignKeyField(DataSource, backref="documents")
#     metadata = TextField()
#     text = TextField()
#
#     class Meta:
#         table_name = 'selfie_document'
class DocumentModel(BaseModel):
    id = AutoField()
    document_connection = ForeignKeyField(DocumentConnectionModel, backref='documents')
    content = TextField()
    content_type = CharField()
    name = CharField()
    size = IntegerField()

    class Meta:
        table_name = 'selfie_document'


class SettingsModel(BaseModel):
    id = AutoField()
    key = CharField(unique=True)
    value = TextField()

    class Meta:
        table_name = 'selfie_settings'


class DataManager:
    def __init__(self, storage_path: str = config.database_storage_root):
        os.makedirs(storage_path, exist_ok=True)

        self.db = SqliteDatabase(os.path.join(storage_path, config.db_name))
        database_proxy.initialize(self.db)
        self.db.connect()
        self.db.create_tables([DocumentConnectionModel, DocumentModel])

    def add_document_connection(
            self,
            connector_name: str,
            configuration: Dict[str, Any],
    ) -> int:
        return DocumentConnectionModel.create(
            connector_name=connector_name,
            configuration=json.dumps(configuration)
        )

    # def remove_data_source(self, source_id: int):
    #     DataSource.get_by_id(source_id).delete_instance()

    async def remove_documents(self, document_ids: List[int], delete_indexed_data: bool = True):
        if delete_indexed_data:
            await DataIndex("n/a").delete_documents_with_source_documents(document_ids)

        try:
            with self.db.atomic():
                DocumentModel.delete().where(DocumentModel.id.in_(document_ids)).execute()
        except Exception as e:
            logger.error(f"Error removing documents, but indexed data was removed: {e}")
            raise e

    async def remove_document(self, document_id: int, delete_indexed_data: bool = True):
        return await self.remove_documents([document_id], delete_indexed_data)

    async def remove_document_connection(self, document_connection_id: int, delete_documents: bool = True,
                                         delete_indexed_data: bool = True):
        if self.get_document_connection(document_connection_id) is None:
            raise ValueError(f"No document connection found with ID {document_connection_id}")

        if delete_indexed_data:
            source_document_ids = [doc.id for doc in DocumentModel.select().where(
                DocumentModel.document_connection == document_connection_id)]
            await DataIndex("n/a").delete_documents_with_source_documents(source_document_ids)

        with self.db.atomic():
            if delete_documents:
                DocumentModel.delete().where(DocumentModel.document_connection == document_connection_id).execute()

            DocumentConnectionModel.delete().where(DocumentConnectionModel.id == document_connection_id).execute()

    def scan_document_connections(self, connection_ids: List[int]) -> Dict[str, Any]:
        changes = {}
        for connection_id in connection_ids:
            document_connection = DocumentConnectionModel.get_by_id(connection_id)

            connection_config = json.loads(document_connection.configuration)
            if connection_config["loader_name"].startswith("selfie"):
                # TODO: last_loaded_timestamp is not currently defined
                connection_config["load_data_kwargs"]["earliest_date"] = document_connection.last_loaded_timestamp

            documents = self._fetch_documents(connection_config)
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

    def _fetch_documents(self, configuration: Dict[str, Any]) -> List[DocumentDTO]:
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

    def _get_unique_key(self, doc, unique_key_path: str):
        keys = unique_key_path.split(".")
        value = doc
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key, None)
            else:
                value = getattr(value, key, None)
        return value

    async def index_documents(self, document_connection: DocumentConnectionModel):
        print("Indexing documents")

        self.scan_document_connections([document_connection.id])

        documents = self._fetch_documents(json.loads(document_connection.configuration))
        documents = [
            document for doc in documents for document in
            self._map_selfie_documents_to_index_documents(selfie_document=doc)
        ]

        await DataIndex("n/a").index(documents, extract_importance=False)

        # TODO: record the last time this data source was indexed

        return {"message": f"{len(documents)} documents indexed successfully"}

    async def index_document(self, document: DocumentDTO, selfie_documents_to_index_documents: Callable[
        [DocumentDTO], List[EmbeddingDocumentModel]] = None):
        print("Indexing document")

        if selfie_documents_to_index_documents is None:
            selfie_documents_to_index_documents = self._map_selfie_documents_to_index_documents

        index_documents = selfie_documents_to_index_documents(document)
        if not index_documents:
            logger.warning("No documents to index")
            return {"message": "No documents to index"}

        return await DataIndex("n/a").index(index_documents, extract_importance=False)

    @staticmethod
    def _map_selfie_documents_to_index_documents(selfie_document: DocumentDTO):
        return [
            EmbeddingDocumentModel(
                text=text_chunk,
                # source=selfie_document.document_connection.connector_name,
                source="Unknown",
                timestamp=DataManager._extract_timestamp(selfie_document),
                source_document_id=selfie_document.id,
            )
            for text_chunk in SentenceSplitter(
                chunk_size=config.embedding_chunks_size,
                chunk_overlap=config.embedding_chunk_overlap
           ).split_text(selfie_document.content)
        ]

    @staticmethod
    def _extract_timestamp(doc):
        return doc.created_at if doc.created_at else datetime.now()

    @staticmethod
    def get_document_connection(document_connection_id: int):
        return DocumentConnectionModel.get_by_id(document_connection_id)

    def get_document_connections(self):
        return [
            model_to_dict(source)
            # {
            #     "name": source.name,
            #     "id": source.id,
            #     "loader_module": source.loader_module,
            #     "config": json.loads(source.config),
            # }
            for source in DocumentConnectionModel.select()
        ]

    def get_documents(self):
        documents = DocumentModel.select(DocumentModel.id, DocumentModel.name, DocumentModel.size,
                                         DocumentModel.created_at, DocumentModel.updated_at,
                                         DocumentModel.content_type, DocumentConnectionModel.connector_name).join(
            DocumentConnectionModel)

        result = []
        for doc in documents:
            doc_dict = model_to_dict(doc, backrefs=True, only=[
                DocumentModel.id, DocumentModel.name, DocumentModel.size,
                DocumentModel.created_at, DocumentModel.updated_at,
                DocumentModel.content_type, DocumentConnectionModel.connector_name
            ])
            doc_dict['connector_name'] = doc.document_connection.connector_name
            result.append(doc_dict)
        return result

    def get_document(self, document_id: str):
        return DocumentModel.get_by_id(document_id)


if __name__ == "__main__":
    manager = DataManager()
