from typing import List, Any, Optional

from pydantic import BaseModel, RootModel

from selfie.parsers.chat.base import JsonBasedChatParser
from selfie.types.share_gpt import ShareGPTConversation
from selfie.utils import check_nested


class Author(BaseModel):
    role: str
    name: str | None
    metadata: dict


class Content(BaseModel):
    content_type: str
    parts: Optional[List[Any]] = None


class Message(BaseModel):
    id: str
    author: Author
    create_time: float | None
    update_time: float | None
    content: Content
    status: str
    end_turn: bool | None
    weight: float
    metadata: dict
    recipient: str


class Node(BaseModel):
    id: str
    message: Message | None
    parent: str | None
    children: List[str]


class ChatGPTConversation(BaseModel):
    title: str
    create_time: float
    update_time: float
    mapping: dict[str, Node]
    moderation_results: List
    current_node: str
    plugin_ids: List | None
    conversation_id: str
    conversation_template_id: str | None
    gizmo_id: str | None
    is_archived: bool
    safe_urls: List
    id: str


class ChatGPTParser(JsonBasedChatParser):
    SUPPORTED_SCHEMAS = [RootModel[List[ChatGPTConversation]]]

    def extract_conversations(self, data: List[ChatGPTConversation]) -> ShareGPTConversation:
        """
        Extract conversations from a list of parsed ChatGPT JSON data.

        Args:
            data (List[ChatGPTConversation]): The list of parsed JSON data

        Returns:
            List[dict]: A list of conversation dictionaries
        """
        conversations = []
        for conversation in data:
            for node_id, node in conversation["mapping"].items():
                if (check_nested(node, "message", "content", "parts") and
                        isinstance(node["message"]["content"]["parts"], list) and
                        all(isinstance(elem, str) for elem in node["message"]["content"]["parts"])):
                    message = node["message"]
                    author_name = message["author"]["name"] if message["author"]["name"] else message["author"]["role"]
                    message_content = ' '.join(message["content"]["parts"])
                    message_timestamp = message["create_time"] or conversation["create_time"]

                    conversations.append({
                        "from": author_name,
                        "value": message_content,
                        "timestamp": message_timestamp
                    })

        return ShareGPTConversation(conversations=conversations)
