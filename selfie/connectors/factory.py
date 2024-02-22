from selfie.connectors.whatsapp.connector import WhatsappConnector
from selfie.connectors.chatgpt.connector import ChatGPTConnector


class ConnectorFactory:
    # Register all document connectors here
    connector_registry = [
        WhatsappConnector,
        ChatGPTConnector
    ]

    connector_map = {}
    for connector in connector_registry:
        instance = connector()
        connector_map[instance.id] = instance

    @staticmethod
    def get_connector(connector_name):
        connector_instance = ConnectorFactory.connector_map.get(connector_name.lower())
        if connector_instance:
            return connector_instance
        else:
            raise ValueError(f"Connector '{connector_name}' not found")

    @staticmethod
    def get_all_connectors():
        return [{"id": c.id, "name": c.name} for c in ConnectorFactory.connector_map.values()]
