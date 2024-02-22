from abc import ABC
from typing import Any

from selfie.connectors.base_connector import BaseConnector


class WhatsappConnector(BaseConnector, ABC):
    def __init__(self):
        super().__init__()
        self.id = "whatsapp"
        self.name = "Whatsapp"

    def load_document(self, configuration: dict[str, Any]):
        super().load_document(configuration)
        # TODO: read configuration (file path), and save file contents to DB

    def validate_configuration(self, configuration: dict[str, Any]):
        # TODO: check if file can be read from path
        pass
