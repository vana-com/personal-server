from abc import ABC
from typing import Any, List

from selfie.connectors.base_connector import BaseConnector
from selfie.database import SelfieDocument
from selfie.embeddings import Document


class WhatsappConnector(BaseConnector, ABC):
    def __init__(self):
        super().__init__()
        self.id = "whatsapp"
        self.name = "Whatsapp"

    def load_document(self, configuration: dict[str, Any]) -> List[SelfieDocument]:
        super().load_document(configuration)
        # TODO: read configuration (file path), return the parsed document
        return []

    def validate_configuration(self, configuration: dict[str, Any]):
        # TODO: check if file can be read from path
        pass

    def transform_for_embedding(self, configuration: dict[str, Any], documents: List[SelfieDocument]) -> List[Document]:
        # TODO: Transform a SelfieDocument into a ShareGPT document so it can be inserted into a Vector DB
        return []
