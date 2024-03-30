from datetime import datetime
import logging
from typing import List, Dict
import re

from selfie.parsers.chat.base import TextBasedChatParser
from selfie.types.share_gpt import ShareGPTMessage

logger = logging.getLogger(__name__)


# TODO: Figure out a better way to solve or at least apply this
def parse_time_with_periods(time_str, format_str):
    # Remove periods from the meridian indicator for compatibility with %p
    return datetime.strptime(time_str.replace('.', ''), format_str)


class WhatsAppParser(TextBasedChatParser):
    SUPPORTED_FORMATS = [
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{1,2}/\d{1,2}/\d{2}, \d{1,2}:\d{2}\s(AM|PM))(?:\])? - (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%m/%d/%y, %I:%M %p",
        },
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{1,2}/\d{1,2}/\d{2}, \d{1,2}:\d{2}:\d{2}\s(AM|PM))(?:\])? (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%m/%d/%y, %I:%M:%S %p",
        },
        {
            "regex": r"(?P<timestamp>\d{4}-\d{1,2}-\d{1,2}, \d{1,2}:\d{2}\s(a\.m\.|p\.m\.)) - (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%Y-%m-%d, %I:%M %p",
        },
        {
            "regex": r"(?P<timestamp>\d{4}-\d{1,2}-\d{1,2}, \d{1,2}:\d{2}(a\.m\.|p\.m\.)) - (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%Y-%m-%d, %I:%M%p",
        },
        {
            "regex": r"\[(?P<timestamp>\d{4}-\d{1,2}-\d{1,2}, \d{1,2}:\d{2}:\d{2}\s(AM|PM))\] (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%Y-%m-%d, %I:%M:%S %p",
        },
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{4}-\d{1,2}-\d{1,2}, \d{1,2}:\d{2}:\d{2}\s(AM|PM))(?:\])? (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%Y-%m-%d, %I:%M:%S %p",
        },
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{1,2}-\d{1,2}-\d{2}, \d{1,2}:\d{2}:\d{2}\s(AM|PM))(?:\])? (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%Y-%m-%d, %I:%M:%S %p",
        },
        {
            "regex": r"\[(?P<timestamp>\d{1,2}/\d{1,2}/\d{2,4}, \d{1,2}:\d{2}:\d{2}\s(AM|PM))\] (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%m/%d/%y, %I:%M:%S %p",
        },
        # Deprecated or unofficial format (?)
        {
            "regex": r"(?P<timestamp>\d{1,2}/\d{1,2}/\d{2}, \d{1,2}:\d{2}(AM|PM)) - (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%m/%d/%y, %I:%M%p",
        },
        {
            "regex": r"\[(?P<timestamp>\d{2}\.\d{2}\.\d{2}, \d{2}:\d{2}:\d{2})\] (?P<from>.+?): (?P<value>.+)",
            "timestamp_format": "%d%m%y, %H:%M:%S",
        },
    ]

    DROP_LINES_LIKE = [
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{1,2}/\d{1,2}/\d{2}, \d{1,2}:\d{2}\s(AM|PM))(?:\])? - (?P<value>.+)",
        },
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{1,2}/\d{1,2}/\d{2}, \d{1,2}:\d{2}:\d{2}\s(AM|PM))(?:\])? (?P<value>.+)",
        },
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{4}-\d{1,2}-\d{1,2}, \d{1,2}:\d{2}\s?(a\.m\.|p\.m\.))(?:\])? - (?P<value>.+)",
        },
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{4}-\d{1,2}-\d{1,2}, \d{1,2}:\d{2}:\d{2}\s(AM|PM))(?:\])? (?P<value>.+)",
        },
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{1,2}-\d{1,2}-\d{2}, \d{1,2}:\d{2}:\d{2}\s(AM|PM))(?:\])? (?P<value>.+)",
        },
        {
            "regex": r"(?:\[)?(?P<timestamp>\d{2}\.\d{2}\.\d{2}, \d{2}:\d{2}:\d{2})(?:\])? (?P<value>.+)",
        }
    ]

    def _preprocess_hook(self, document: str) -> str:
        """
        WhatsApp includes messages like "You added Alice" and "Messages and calls are encrypted", remove them.
        """
        # Remove lines that do not match the supported formats and do match the filter lines
        keep_formats, remove_formats = [re.compile(fmt['regex'], flags=re.DOTALL) for fmt in self.SUPPORTED_FORMATS], [re.compile(drp['regex'], flags=re.DOTALL) for drp in self.DROP_LINES_LIKE]
        new_doc = '\n'.join([
            line for line in document.split('\n')
            if not any(fmt.match(line) for fmt in remove_formats) or any(flt.match(line) for flt in keep_formats)
        ])
        removed_count = len(document.splitlines()) - len(new_doc.splitlines())
        if removed_count:
            logger.debug(f"Ignoring {removed_count} of {len(document.splitlines())} lines from WhatsApp chat")
        return new_doc

    def parse_message(self, raw_message: List[str]) -> ShareGPTMessage:
        """
        Parse a single WhatsApp message from a list of lines that make up that message.

        Args:
            raw_message (List[str]): List of lines belonging to the same message.
                                     e.g., ["[1/1/21, 12:00 AM] Alice: Hi", "How are you?"]

        Returns:
            Dict[str, str]: A dictionary representing the parsed message.
                            Example structure:
                            {
                                "from": "Alice",
                                "value": "Hi\nHow are you?",
                                "timestamp": "2021-01-01T12:00:00Z"
                            }
        """

        full_message = "\n".join(raw_message)
        for format in self.SUPPORTED_FORMATS:
            match = re.match(format['regex'], full_message, flags=re.DOTALL)
            if match:
                groups = match.groupdict()
                timestamp_dt = parse_time_with_periods(groups['timestamp'], format['timestamp_format']).replace(tzinfo=self.timezone)
                groups['timestamp'] = timestamp_dt.isoformat()
                return ShareGPTMessage.model_validate(groups)
