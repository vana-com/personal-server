from pydantic import BaseModel, Field
from typing import List
from datetime import datetime


class ShareGPTMessage(BaseModel):
    from_user: str = Field(..., alias='from', description="The sender of the message")
    value: str = Field(..., description="The content of the message")
    timestamp: datetime = Field(..., description="Timestamp of when the message was sent")


class ShareGPTConversation(BaseModel):
    conversations: List[ShareGPTMessage] = Field(..., description="List of messages in the conversation")


class ShareGPT(BaseModel):
    data: ShareGPTConversation = Field(..., description="Structured conversation data")

    class Config:
        populate_by_name = True
