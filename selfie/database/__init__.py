# TODO: This is an *incomplete* migration of functionality to service.py.
# This should not contain any database operations, only initialization. All
# operations should be contained in the service.

import json
import logging
import os
from datetime import datetime
from typing import Dict, Any

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

from selfie.config_ini import load_config
from selfie.utils.filesystem import resolve_path

logger = logging.getLogger(__name__)

database_proxy = Proxy()

config = load_config()

storage_root = resolve_path(config.get('database', 'storage_root'))
db_name = config.get('database', 'db_name')


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
    def __init__(self, storage_path: str = storage_root):
        os.makedirs(storage_path, exist_ok=True)

        self.db = SqliteDatabase(os.path.join(storage_path, db_name))
        database_proxy.initialize(self.db)
        self.db.connect()
        self.db.create_tables([DocumentConnectionModel, DocumentModel, SettingsModel])

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

    def _get_unique_key(self, doc, unique_key_path: str):
        keys = unique_key_path.split(".")
        value = doc
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key, None)
            else:
                value = getattr(value, key, None)
        return value

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

    def save_settings(self, settings: Dict[str, Any], delete_others: bool = False):
        logger.info(f"Saving settings: {settings}")
        with self.db.atomic():
            if delete_others:
                SettingsModel.delete().execute()
            for key, value in settings.items():
                if isinstance(value, dict):
                    for nested_key, nested_value in value.items():
                        SettingsModel.replace(key=f"{key}.{nested_key}", value=json.dumps(nested_value)).execute()
                else:
                    SettingsModel.replace(key=key, value=json.dumps(value)).execute()

    def get_settings(self) -> Dict[str, Any]:
        settings = {}
        for setting in SettingsModel.select():
            keys = setting.key.split(".")
            value = json.loads(setting.value)
            if len(keys) == 1:
                settings[keys[0]] = value
            else:
                nested_dict = settings.setdefault(keys[0], {})
                nested_dict[keys[1]] = value
        return settings


if __name__ == "__main__":
    manager = DataManager()
