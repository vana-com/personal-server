from datetime import datetime
from bs4 import BeautifulSoup
from selfie.parsers.chat.base import HtmlBasedChatParser
from selfie.types.share_gpt import ShareGPTConversation, ShareGPTMessage

from typing import List, Optional
from pydantic import BaseModel


class TelegramMessage(BaseModel):
    id: Optional[str]
    timestamp: Optional[str]
    author: Optional[str]
    content: Optional[str]
    link: Optional[str]


class TelegramConversation(BaseModel):
    title: Optional[str]
    messages: List[TelegramMessage]


class TelegramParser(HtmlBasedChatParser):
    SUPPORTED_SCHEMAS = [TelegramConversation]

    def _parse_html_to_model_hook(self, html_string: str) -> TelegramConversation:
        soup = BeautifulSoup(html_string, 'html.parser')
        title = soup.find('div', class_='text bold').text.strip() if soup.find('div', class_='text bold') else None

        messages = []
        for message_div in soup.find_all('div', class_='message'):
            id = message_div.get('id')
            timestamp = message_div.find('div', class_='pull_right').get('title') if message_div.find('div', class_='pull_right') else None
            author = message_div.find('div', class_='from_name').text.strip() if message_div.find('div', class_='from_name') else None
            content = message_div.find('div', class_='text').text.strip() if message_div.find('div', class_='text') else None
            link = message_div.find('a')['href'] if message_div.find('a') else None

            if content:
                messages.append(TelegramMessage(
                    id=id,
                    timestamp=timestamp,
                    author=author,
                    content=content,
                    link=link
                ))

        return TelegramConversation(title=title, messages=messages)

    def extract_conversations(self, data: TelegramConversation) -> ShareGPTConversation:
        share_gpt_messages = []

        for message in data.messages:
            timestamp = datetime.strptime(message.timestamp, "%d.%m.%Y %H:%M:%S %Z%z") if message.timestamp else None
            from_user = message.author if message.author else "Unknown"
            content = message.content if message.content else "No content"

            share_gpt_messages.append(ShareGPTMessage(**{
                'from': from_user,
                'value': content,
                'timestamp': timestamp,
            }))

        return ShareGPTConversation(conversations=share_gpt_messages)
