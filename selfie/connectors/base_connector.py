import abc
import json
import os
from typing import Any


class BaseConnector(abc.ABC):
    def __init__(self):
        self.id = "base_connector"
        self.name = "Base Connector"

    @abc.abstractmethod
    def load_document(self, configuration: dict[str, Any]):
        self.validate_configuration(configuration)

    @abc.abstractmethod
    def validate_configuration(self, configuration: dict[str, Any]):
        raise NotImplementedError

    def get_form_schema(self):
        return self._read_json_file("schema.json")

    def get_ui_schema(self):
        return self._read_json_file("uischema.json")

    def get_documentation_markdown(self):
        return self._read_file("documentation.md")

    def _read_file(self, file_name: str) -> str | None:
        file_path = os.path.join(os.path.dirname(__file__), self.id, file_name)
        if os.path.exists(file_path):
            with open(file_path, 'r') as file:
                return file.read()
        else:
            return None

    def _read_json_file(self, file_name: str):
        file_contents = self._read_file(file_name)
        return None if not file_contents else json.loads(file_contents)
