from datetime import datetime
from typing import Dict, Any, List

from pydantic import BaseModel

from selfie.parsers.chat.base import JsonBasedChatParser
from selfie.types.share_gpt import ShareGPTConversation


class Author(BaseModel):
    name: str


class Message(BaseModel):
    author: Author
    content: str
    timestamp: datetime


class DiscordData(BaseModel):
    messages: List[Message]


# TODO: This is a hypothetical parser for Discord data. It's not tested.
# TODO: Consider compatibility with https://github.com/run-llama/llama-hub/blob/main/llama_hub/discord/base.py
class DiscordParser(JsonBasedChatParser):
    SUPPORTED_SCHEMAS = [
        DiscordData
    ]

    def extract_conversations(self, data: Any) -> ShareGPTConversation:
        """
        Extract conversations from parsed Discord JSON data.

        Args:
            data (Any): The parsed JSON data should have a structure like:
                        {
                            "messages": [
                                {"author": {"name": "Alice"}, "content": "Hi", "timestamp": "2021-01-01T12:00:00Z"},
                                {"author": {"name": "Bob"}, "content": "Hello", "timestamp": "2021-01-01T12:01:00Z"}
                            ]
                        }

        Returns:
            Dict: A dictionary containing the parsed chat data.
                  Example structure:
                  {
                      "conversations": [
                          {"from": "Alice", "value": "Hi", "timestamp": "2021-01-01T12:00:00Z"},
                          {"from": "Bob", "value": "Hello", "timestamp": "2021-01-01T12:01:00Z"}
                      ]
                  }
        """
        return ShareGPTConversation(
            conversations=[
                {
                    "from": msg['author']['name'],
                    "value": msg['content'],
                    "timestamp": msg['timestamp']
                } for msg in data['messages']
            ]
        )
