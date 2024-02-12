import os
from datetime import datetime, timezone

from llama_index.node_parser import SentenceSplitter
from peewee import (
    Model,
    SqliteDatabase,
    CharField,
    TextField,
    ForeignKeyField,
    AutoField,
    DoesNotExist,
    Proxy,
)
import json
import importlib
from typing import List, Dict, Any, Optional, Callable

from selfie.config import get_app_config
from selfie.embeddings import DataIndex
from selfie.embeddings.document_types import Document

import logging
logger = logging.getLogger(__name__)

database_proxy = Proxy()

config = get_app_config()

class BaseModel(Model):
    class Meta:
        database = database_proxy


class DataSource(BaseModel):
    id = AutoField()
    name = CharField()
    loader_module = CharField()
    config = TextField()

    class Meta:
        table_name = 'selfie_datasource'


class SelfieDocument(BaseModel):
    id = AutoField()
    source = ForeignKeyField(DataSource, backref="documents")
    metadata = TextField()
    text = TextField()

    class Meta:
        table_name = 'selfie_document'


class DataManager:
    def __init__(self, storage_path: str = config.database_storage_root):
        os.makedirs(storage_path, exist_ok=True)

        self.db = SqliteDatabase(os.path.join(storage_path, config.db_name))
        database_proxy.initialize(self.db)
        self.db.connect()
        self.db.create_tables([DataSource, SelfieDocument])

    def add_data_source(
        self,
        name: str,
        loader_module: str,
        constructor_args: List[Any],
        constructor_kwargs: Dict[str, Any],
        load_data_args: List[Any],
        load_data_kwargs: Dict[str, Any],
    ) -> int:
        config = {
            "constructor_args": constructor_args,
            "constructor_kwargs": constructor_kwargs,
            "load_data_args": load_data_args,
            "load_data_kwargs": load_data_kwargs,
        }
        return DataSource.create(
            name=name, loader_module=loader_module, config=json.dumps(config)
        )

    # def remove_data_source(self, source_id: int):
    #     DataSource.get_by_id(source_id).delete_instance()

    async def remove_document(self, document_id: int, delete_indexed_data: bool = True):
        with self.db.atomic():
            document = SelfieDocument.get_by_id(document_id)
            if document is None:
                raise ValueError(f"No document found with ID {document_id}")

            if delete_indexed_data:
                index = DataIndex("n/a")
                await index.delete_documents_with_source_documents([document.source_id])

            document.delete_instance()

    async def remove_data_source(self, source_id: int, delete_documents: bool = True, delete_indexed_data: bool = True):
        data_source = self.get_data_source(source_id)
        if data_source is None:
            raise ValueError(f"No data source found with ID {source_id}")

        if delete_indexed_data:
            source_document_ids = [doc.id for doc in SelfieDocument.select().where(SelfieDocument.source == source_id)]
            await DataIndex("n/a").delete_documents_with_source_documents(source_document_ids)

        with self.db.atomic():
            if delete_documents:
                SelfieDocument.delete().where(SelfieDocument.source == source_id).execute()

            DataSource.delete().where(DataSource.id == source_id).execute()

    def scan_data_sources(self, source_ids: List[int]) -> Dict[str, Any]:
        changes = {}
        for source_id in source_ids:
            data_source = DataSource.get_by_id(source_id)
            documents = self._fetch_documents(
                data_source.loader_module, json.loads(data_source.config)
            )
            for doc in documents:
                document, created = SelfieDocument.get_or_create(
                    source=data_source, defaults={"metadata": json.dumps(doc.metadata)}, text=doc.text
                )
                changes[document.id] = "Created" if created else "Updated"
        return changes

    def _fetch_documents(self, loader_module: str, config: Dict[str, Any]) -> List[Any]:
        module_name, class_name = loader_module.rsplit(".", 1)
        module = importlib.import_module(module_name)
        loader_class = getattr(module, class_name)
        loader = loader_class(
            *config["constructor_args"], **config["constructor_kwargs"]
        )
        return loader.load_data(*config["load_data_args"], **config["load_data_kwargs"])

    def _get_unique_key(self, doc, unique_key_path: str):
        keys = unique_key_path.split(".")
        value = doc
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key, None)
            else:
                value = getattr(value, key, None)
        return value

    async def index_documents(self, data_source: DataSource):
        print("Indexing documents")

        # Ensure that the data source is in the database
        self.scan_data_sources([data_source.id])

        loader_module = data_source.loader_module

        documents = self._fetch_documents(loader_module, json.loads(data_source.config))
        documents = [
            document for doc in documents for document in self._map_selfie_documents_to_index_documents(selfie_document=doc)
        ]

        await DataIndex("n/a").index(documents, extract_importance=False)

        # TODO: record the last time this data source was indexed

        return {"message": f"{len(documents)} documents indexed successfully"}

    async def index_document(self, document: SelfieDocument, selfie_documents_to_index_documents: Callable[[SelfieDocument], List[Document]] = None):
        print("Indexing document")

        if selfie_documents_to_index_documents is None:
            selfie_documents_to_index_documents = self._map_selfie_documents_to_index_documents

        index_documents = selfie_documents_to_index_documents(document)
        if not index_documents:
            logger.warning("No documents to index")
            return {"message": "No documents to index"}

        return await DataIndex("n/a").index(index_documents, extract_importance=False)

    @staticmethod
    def _map_selfie_documents_to_index_documents(selfie_document: SelfieDocument):
        text_parser = SentenceSplitter(chunk_size=1024)
        documents = []

        for text_chunk in text_parser.split_text(selfie_document.text):
            documents.append(Document(
                text=text_chunk,
                source=selfie_document.source,
                timestamp=DataManager._extract_timestamp(selfie_document),
                source_document_id=selfie_document.id,
            ))

        return documents

    @staticmethod
    def _extract_timestamp(doc):
        last_modified = doc.metadata.get("last_modified")
        if last_modified:
            return datetime.strptime(last_modified, "%Y-%m-%d")
        return datetime.now()

    @staticmethod
    def get_data_source(source_id: int):
        try:
            return DataSource.get_by_id(source_id)
        except DoesNotExist:
            return {"error": "Data source not found"}
        except Exception as e:
            return {"error": str(e)}

    def get_data_sources(self):
        return [
            {
                "name": source.name,
                "id": source.id,
                "loader_module": source.loader_module,
                "config": json.loads(source.config),
            }
            for source in DataSource.select()
        ]

    def get_documents(self, source_id: Optional[int] = None):
        if source_id:
            documents = SelfieDocument.select().where(SelfieDocument.source_id == source_id)
            doc_ids = [str(document.id) for document in documents]
        else:
            documents = SelfieDocument.select()
            doc_ids = None

        one_indexed_document_per_source = DataIndex("n/a").get_one_document_per_source_document(doc_ids)
        indexed_documents = list(set([doc['source_document_id'] for doc in one_indexed_document_per_source]))

        return [
            # TODO: for some reason, initializing Embeddings in DataIndex with the SQLAlchemy driver returns indexed_documents as strings, not ints (requires str(doc.id)).
            {"id": doc.id, "metadata": json.loads(doc.metadata), "is_indexed": doc.id in indexed_documents, "num_index_documents": DataIndex("n/a").get_document_count([str(doc.id)])} for doc in documents
        ]

    def get_document(self, document_id: str):
        return SelfieDocument.get_by_id(document_id)


if __name__ == "__main__":
    manager = DataManager()

    # # Adding a SimpleWebPageReader data source
    # constructor_args_web = []
    # constructor_kwargs_web = {"html_to_text": True}
    # load_data_args_web = []
    # load_data_kwargs_web = {"urls": ["http://paulgraham.com/worked.html"]}
    # source_id_web = manager.add_data_source("llama_index.readers.SimpleWebPageReader", constructor_args_web, constructor_kwargs_web, load_data_args_web, load_data_kwargs_web, "metadata.url").id
    #
    # # Adding a SimpleDirectoryReader data source
    # constructor_args_dir = []
    # constructor_kwargs_dir = {"input_dir": "/home/tnunamak/Downloads/tim_misc_text", "recursive": True, "num_files_limit": 5}
    # load_data_args_dir = []
    # load_data_kwargs_dir = {}
    # source_id_dir = manager.add_data_source("llama_index.readers.SimpleDirectoryReader", constructor_args_dir, constructor_kwargs_dir, load_data_args_dir, load_data_kwargs_dir, "metadata.file_path").id

    # Scanning data sources
    # changes_web = manager.scan_data_sources([source_id_web])
    # changes_dir = manager.scan_data_sources([source_id_dir])
    # print("Web Changes:", changes_web)
    # print("Directory Changes:", changes_dir)

    # for data_source in DataSource.select():
    #     manager.index_documents(data_source)
    # print(data_source.id, data_source.loader_module, data_source.config)

    # source_id = -1  # Example source ID
    # result = manager.index_documents(source_id)
    # print(result)

    # Cleanup
    # manager.remove_data_source(source_id_web)
    # manager.remove_data_source(source_id_dir)
