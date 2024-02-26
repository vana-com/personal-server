from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime


class BaseDTO(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class DocumentDTO(BaseDTO):
    id: Optional[int] = None
    document_connection_id: Optional[int] = None
    content: str
    content_type: str
    name: str
    size: int


class DocumentConnectionDTO(BaseDTO):
    id: Optional[int] = None
    connector_name: str
    configuration: Dict[str, Any]
