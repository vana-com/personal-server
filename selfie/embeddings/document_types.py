from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field, model_validator


class EmbeddingDocumentModel(BaseModel):
    id: Optional[int] = Field(None, description="ID of the document, auto-generated")
    text: str = Field(..., description="Formatted conversation or content of the document")
    source: str = Field(..., description="Source of the document, e.g., API")
    importance: Optional[float] = Field(None, description="Importance score of the document, [0, 1]")
    timestamp: datetime = Field(..., description="The time that the event happened at, e.g. the time a message was sent")

    created_timestamp: datetime = Field(..., description="Time when the document was first indexed")
    updated_timestamp: Optional[datetime] = Field(None, description="Time when the document was last updated")
    source_document_id: Optional[int] = Field(None, description="ID of the source document")

    def to_dict(self, *args, **kwargs):
        d = super().model_dump(*args, **kwargs)
        d['timestamp'] = self.timestamp.replace(tzinfo=timezone.utc).isoformat() if self.timestamp else None
        d['created_timestamp'] = self.created_timestamp.replace(tzinfo=timezone.utc).isoformat() if self.created_timestamp else None
        d['updated_timestamp'] = self.updated_timestamp.replace(tzinfo=timezone.utc).isoformat() if self.updated_timestamp else None
        return d

    class Config:
        validate_assignment = True
        json_schema_extra = {
            "example": {
                "id": 42,
                "text": "What is the meaning of life?",
                "source": "whatsapp",
                "importance": None,
                "timestamp": "2022-01-01T00:00:00Z",
                "created_timestamp": "2022-01-01T00:00:00Z",
                "updated_timestamp": "2022-01-01T00:00:00Z",
                "source_document_id": 42
            }
        }

    @model_validator(mode='before')
    def autofill_timestamps(cls, values):
        if 'created_timestamp' not in values:
            values['created_timestamp'] = datetime.utcnow()
        values['updated_timestamp'] = datetime.utcnow()
        return values


class ScoredEmbeddingDocumentModel(EmbeddingDocumentModel):
    score: float = Field(..., description="Overall score of the document, for a query, [0, 1]")
    importance: Optional[float] = Field(..., description="Importance score of the document, [0, 1]")
    relevance: float = Field(..., description="Relevance score of the document, for a query, [0, 1]")
    recency: float = Field(..., description="Recency score of the document, for a query (time), [0, 1]")

    model_config = {
        "json_schema_extra": {
            "example": {
                **EmbeddingDocumentModel.model_config['json_schema_extra']['example'],
                "score": 0.42,
                "relevance": 0.42,
                "recency": 0.42,
                "importance": None,  # For now
            }
        }
    }
