from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from selfie.connectors.factory import ConnectorFactory

router = APIRouter()


class Connector(BaseModel):
    id: str
    name: str
    documentation: Optional[str] = None
    form_schema: Optional[dict] = None
    ui_schema: Optional[dict] = None


class ConnectorsResponse(BaseModel):
    connectors: List[Connector] = []


@router.get("/connectors")
async def get_connectors() -> ConnectorsResponse:
    connectors = ConnectorFactory.get_all_connectors()
    return ConnectorsResponse(connectors=connectors)


@router.get("/connectors/{connector_name}")
async def get_connector(connector_name: str) -> Connector:
    connector_instance = ConnectorFactory.get_connector(connector_name=connector_name)
    return Connector(
        id=connector_instance.id,
        name=connector_instance.name,
        documentation=connector_instance.get_documentation_markdown(),
        form_schema=connector_instance.get_form_schema(),
        ui_schema=connector_instance.get_ui_schema(),
    )
