import json
import re
from typing import List, Dict, Any
from datetime import timezone

from pydantic import ValidationError

from selfie.types.share_gpt import ShareGPTConversation, ShareGPTMessage

import logging
logger = logging.getLogger(__name__)


class ChatParser:
    """
    The base class for chat parsers. Don't use this class directly; it's meant to be subclassed.
    """
    def __init__(self, timezone=timezone.utc):
        self.timezone = timezone

    def preprocess(self, document: str) -> str:
        return self._preprocess_hook(document)

    def _preprocess_hook(self, document: str) -> str:
        return document

    def can_parse(self, document: str) -> bool:
        """
        Check if this parser can parse the given document.

        Args:
            document (str): The document to check.

        Returns:
            bool: True if this parser can parse the given document.
        """
        preprocessed_document = self.preprocess(document)
        return self._can_parse_hook(preprocessed_document)

    def _can_parse_hook(self, document: str) -> bool:
        """
        Hook method for subclasses to implement can_parse logic.
        """
        return False

    @staticmethod
    def remove_non_printable(text: str) -> str:
        """
        Remove non-printable characters from a text string.

        Args:
            text (str): Input string, e.g., "Hello\rWorld\u200e"

        Returns:
            str: A new string with non-printable characters removed, e.g., "HelloWorld"
        """
        text = text.replace('\r', '').replace('\u200e', '')
        return ''.join(char for char in text if char.isprintable())

    def parse_chat(self, document: str) -> ShareGPTConversation:
        """
        Parse raw chat data into a structured format.

        Args:
            document (str): The raw chat data. Could be text or JSON.

        Returns:
            Dict: A dictionary containing the parsed chat data.
                  Example structure:
                  {
                      "conversations": [
                          {"from": "Alice", "value": "Hi!", "timestamp": "2021-01-01T12:00:00Z"},
                          {"from": "Bob", "value": "Hello!", "timestamp": "2021-01-01T12:01:00Z"}
                      ]
                  }
        """
        preprocessed_document = self.preprocess(document)
        return self._parse_chat_hook(preprocessed_document)

    def _parse_chat_hook(self, document: str) -> ShareGPTConversation:
        """
        Hook method for subclasses to implement parse_chat logic.
        """
        raise NotImplementedError


class TextBasedChatParser(ChatParser):
    def _can_parse_hook(self, document: str) -> bool:
        logger.debug(f"Trying to parse {document[:10]} with {self.__class__.__name__}")
        return any(re.match(fmt['regex'], document.splitlines()[0], re.DOTALL) for fmt in self.SUPPORTED_FORMATS)

    """
    Parser for chat data that is text-based like WhatsApp.
    """
    SUPPORTED_FORMATS: List[Dict[str, str]] = []

    def is_new_message(self, line: str) -> bool:
        """
        Checks if a line of text is the start of a new message.
        """
        return any(bool(re.match(format['regex'], line)) for format in self.SUPPORTED_FORMATS)

    def group_lines(self, raw_lines: List[str]) -> List[List[str]]:
        """
        Groups lines of text that belong to the same message.

        Args:
            raw_lines (List[str]): List of chat lines.
                                   e.g., ["[2021-01-01] Alice: Hi", "How are you?", "[2021-01-01] Bob: Good"]

        Returns:
            List[List[str]]: List of message groups, where each group is a list of lines belonging to the same message.
                             e.g., [["[2021-01-01] Alice: Hi", "How are you?"], ["[2021-01-01] Bob: Good"]]
        """
        lines = []
        current_message = []
        for line in raw_lines:
            if self.is_new_message(line):
                if current_message:
                    lines.append(current_message)
                current_message = [line.strip()]
            else:
                current_message.append(line.strip())
        if current_message:
            lines.append(current_message)
        return lines

    def _parse_chat_hook(self, document: str) -> ShareGPTConversation:
        """
        Parse a document of line-by-line messages into a structured chat format.

        Args:
            document (str): A list of lines from the chat log.
                                   e.g., ["[2021-01-01] Alice: Hi", "[2021-01-01] Bob: Hello"]

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
        lines = [self.remove_non_printable(line) for line in document.splitlines()]
        grouped_lines = self.group_lines(lines)
        parsed_data = [self.parse_message(bundle) for bundle in grouped_lines]

        if len(parsed_data) == 0:
            raise ValueError("Parser found no messages in chat log.")

        return ShareGPTConversation(conversations=[msg for msg in parsed_data if msg is not None])

    def parse_message(self, raw_message: List[str]) -> ShareGPTMessage:
        """
        Parse a single message from a list of lines that make up that message.

        Args:
            raw_message (List[str]): List of lines belonging to the same message.
                                     e.g., ["[2021-01-01] Alice: Hi", "How are you?"]

        Returns:
            Dict[str, str]: A dictionary representing the parsed message.
                            Example structure:
                            {
                                "from": "Alice",
                                "value": "Hi\nHow are you?",
                                "timestamp": "2021-01-01T12:00:00Z"
                            }
        """
        pass


class JsonBasedChatParser(ChatParser):
    """
    Parser for chat data that is JSON-based like Discord exports.
    """
    SUPPORTED_SCHEMAS: List[Any] = []

    def _can_parse_hook(self, document: str) -> bool:
        logger.debug(f"Trying to parse {document[:10]} with {self.__class__.__name__}")
        try:
            return any(schema.parse_obj(json.loads(document)) for schema in self.SUPPORTED_SCHEMAS)
        except (json.JSONDecodeError, ValidationError) as e:
            logger.debug(f"Failed to parse {document[:10]} with {self.__class__.__name__}: {e}")
            return False

    def _parse_chat_hook(self, document: str) -> ShareGPTConversation:
        return self.extract_conversations(json.loads(document))

    def extract_conversations(self, data: Any) -> ShareGPTConversation:
        """
        Extract conversations from parsed JSON data.

        Args:
            data (Any): The parsed JSON data.

        Returns:
            Dict: A dictionary containing the parsed chat data.
                  Must be implemented by subclasses.
        """
        raise NotImplementedError

