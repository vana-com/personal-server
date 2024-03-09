from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from selfie.connectors.whatsapp.connector import WhatsAppConnector
from selfie.connectors.factory import ConnectorFactory

router = APIRouter(tags=["Configuration"])

example = {
    "id": WhatsAppConnector().id,
    "name": WhatsAppConnector().name,
    "documentation": "WhatsApp is a popular messaging app...", # TODO: Read this from connectors/whatsapp, maybe truncate
    "form_schema": {  # TODO: Read this from connectors/whatsapp
        "title": "Upload WhatsApp Conversations",
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "title": "Files",
                "description": "Upload .txt files exported from WhatsApp",
                "items": {
                    "type": "object"
                }
            }
        }
    },
    "ui_schema": {  # TODO: Read this from connectors/whatsapp
        "files": {
            "ui:widget": "nativeFile",
            "ui:options": {
                "accept": ".txt"
            }
        }
    }
}


class Connector(BaseModel):
    id: str
    name: str
    documentation: Optional[str] = None
    form_schema: Optional[dict] = None
    ui_schema: Optional[dict] = None

    model_config = {
        "json_schema_extra": {
            "example": example
        }
    }


class ConnectorsResponse(BaseModel):
    connectors: List[Connector] = []


@router.get("/connectors",
            description="""List all available connectors. This endpoint fetches and returns a comprehensive list of all connectors configured in the system, along with their respective details including ID, name, optional documentation, form schema, and UI schema if available.

### Response Format
Returns a `ConnectorsResponse` object containing a list of `Connector` objects each detailing a connector available in the system.
""")
async def get_connectors() -> ConnectorsResponse:
    connectors = ConnectorFactory.get_all_connectors()
    return ConnectorsResponse(connectors=connectors)


@router.get("/connectors/{connector_id}",
            description="Retrieve detailed information about a specific connector by its ID. This includes its name, documentation, and any schemas related to form and UI configurations.")
async def get_connector(connector_id: str) -> Connector:
    connector_instance = ConnectorFactory.get_connector(connector_name=connector_id)
    return Connector(
        id=connector_instance.id,
        name=connector_instance.name,
        documentation=connector_instance.get_documentation_markdown(),
        form_schema=connector_instance.get_form_schema(),
        ui_schema=connector_instance.get_ui_schema(),
    )
