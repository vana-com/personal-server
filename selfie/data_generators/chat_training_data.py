#!/usr/bin/env python3

from typing import List, Dict, Callable
from enum import Enum
import os
import time
import json
import random
import argparse
import logging
from itertools import groupby
from selfie.parsers.chat import ChatFileParser, Parser
from selfie.types.share_gpt import ShareGPTMessage

logger = logging.getLogger(__name__)


class Strategy(Enum):
    BUNDLE = 'bundle'
    CONVERSATION = 'conversation'


# TODO: Figure out what to do with time-based conversations that don't start/end with the right speaker
class ChatTrainingDataGenerator:
    @staticmethod
    def write_jsonl_file(output_file, lines, output_dir="."):
        with open(os.path.join(output_dir, output_file), 'w', encoding='utf-8') as file:
            for line in lines:
                file.write(line + '\n')

    @staticmethod
    def write_json_file(output_file, lines, output_dir="."):
        with open(os.path.join(output_dir, output_file), 'w', encoding='utf-8') as file:
            file.write('[\n')
            file.write(',\n'.join(lines))
            file.write('\n]')

    @staticmethod
    def group_messages_into_conversations(messages: List[ShareGPTMessage], max_time_gap_seconds: int = 1800) -> List[List[ShareGPTMessage]]:
        conversations = []
        current_conversation = []

        i = 0
        while i < len(messages):
            if i > 0:
                prev_timestamp = messages[i - 1].timestamp
                current_timestamp = messages[i].timestamp
                time_gap = (current_timestamp - prev_timestamp).seconds

                # Check if the time gap is exceeded and there's more than one speaker
                single_speaker = len(set(msg.from_user for msg in current_conversation)) == 1
                if time_gap > max_time_gap_seconds and not single_speaker:
                    conversations.append(current_conversation)
                    current_conversation = []

            current_conversation.append(messages[i])
            i += 1

        if current_conversation:
            conversations.append(current_conversation)

        return conversations

    @staticmethod
    def extract_message_bundles(conversations: List[ShareGPTMessage]):
        message_bundles = []
        current_bundle = []
        last_speaker = None
        for convo in conversations:
            speaker = convo.from_user
            if speaker != last_speaker:
                if current_bundle:
                    message_bundles.append(current_bundle)
                    current_bundle = []
            current_bundle.append(convo)
            last_speaker = speaker
        if current_bundle:
            message_bundles.append(current_bundle)
        return message_bundles

    @staticmethod
    def group_messages_into_chunks(conversations: List[ShareGPTMessage], tokenizer: Callable, overlap: int = 0, max_messages: int = 3, max_tokens: int = 0) -> List[List[ShareGPTMessage]]:
        chunks = []
        index = 0
        while index < len(conversations):
            end_index = index + max_messages
            chunk = conversations[index:end_index]

            if max_tokens > 0:
                tokens_count = sum(len(tokenizer(msg.value)) for msg in chunk)
                while tokens_count > max_tokens and len(chunk) > 0:
                    if len(chunk) == 1:
                        logger.warning(f"Warning: A single message exceeds the max tokens limit ({max_tokens}).")
                    chunk.pop()
                    tokens_count = sum(len(tokenizer(msg.value)) for msg in chunk)

            chunks.append(chunk)
            index += max_messages - overlap

        return chunks

    @staticmethod
    def generate_sharegpt_jsonl_line(messages: List[ShareGPTMessage]) -> str:
        """
        Generate a JSONL line in ShareGPT format.

        Args:
            messages (List[Dict[str, str]]): List of message dictionaries.

        Returns:
            str: A JSONL line.
        """
        grouped_messages = [(k, list(g)) for k, g in groupby(messages, key=lambda x: x.from_user)]
        concatenated_messages = []

        for speaker, group in grouped_messages:
            concatenated_text = "\n".join([msg.value for msg in group])
            timestamp = group[-1].timestamp
            concatenated_messages.append({'from': speaker, 'value': concatenated_text, 'timestamp': timestamp})

        conversation = {"conversations": concatenated_messages}

        return json.dumps(conversation, ensure_ascii=False, indent=2)

    def __init__(self, target_format='llama-chat', strategy=Strategy.BUNDLE, train_split=0.9, validate_split=None, mask=False, no_overlap=False, final_format='replicate', additional_blacklist_patterns=None):
        self.file_parser = ChatFileParser(additional_blacklist_patterns)
        self.strategy = strategy
        self.target_format = target_format
        self.target_format_mapper = {
            'llama-chat': self.generate_llama_jsonl_line,
            'sharegpt': self.generate_sharegpt_jsonl_line,
        }[self.target_format]
        self.mask = mask
        self.no_overlap = no_overlap
        self.final_format = final_format
        self.train_split = train_split
        self.validate_split = 1.0 - self.train_split if validate_split is None else validate_split
        self.test_split = 1.0 - (self.train_split + self.validate_split)

    def create_jsonl_line(self, prompt: str, completion: str) -> str:
        if self.final_format == 'colab':
            example = {"text": f"{prompt} {completion}"}
        else:  # 'replicate' format
            example = {"prompt": prompt, "completion": f'{completion} '}

        return json.dumps(example, ensure_ascii=False)

    def generate_llama_jsonl_line(self, messages: List[ShareGPTMessage]):
        grouped_messages = [(speaker, list(g)) for speaker, g in groupby(messages, key=lambda x: x.from_user)]

        inst_flag = True  # Whether to wrap the message in [INST] tags
        segments = []

        for speaker, group in grouped_messages:
            speaker_text = f"{speaker}: " + "\n".join([msg.value for msg in group])

            if inst_flag:
                segments.append(f"[INST] {speaker_text} [/INST]")
            else:
                segments.append(f"{speaker_text}")

            inst_flag = not inst_flag

        prompt = f'<s>[INST] <<SYS>>\nComplete the chat below.\n<</SYS>>\n\n'
        prompt += " ".join(segments[:-1]).removeprefix("[INST] ")

        completion = segments[-1] + " </s>"

        return self.create_jsonl_line(prompt, completion)

    def process_files(self, files_with_settings: List[Dict], output_dir='.'):
        print(f"Processing {len(files_with_settings)} files...")
        all_conversations = []
        for file_setting in files_with_settings:
            input_file = file_setting['file']
            parser_type = file_setting['config'].format or Parser.WHATSAPP.name
            rename_speakers = file_setting['config'].speaker_aliases or {}
            filter_speaker = file_setting['config'].main_speaker

            if filter_speaker in rename_speakers:
                filter_speaker = rename_speakers[filter_speaker]

            share_gpt_data = self.file_parser.parse_file(input_file, parser_type, rename_speakers, self.mask)
            print(f"Number of conversations: {len(share_gpt_data.conversations)}")
            # print(share_gpt_data)

            if self.strategy == Strategy.BUNDLE:
                message_bundles = self.extract_message_bundles(share_gpt_data.conversations)
                jsonl_lines = self.generate_jsonl_from_bundles(message_bundles, filter_speaker)
            elif self.strategy == Strategy.CONVERSATION:
                conversations = self.group_messages_into_conversations(share_gpt_data.conversations, max_time_gap_seconds=1800)
                jsonl_lines = self.generate_jsonl_from_conversations(conversations)
            else:
                raise ValueError(f"Invalid strategy: {self.strategy}")

            all_conversations.extend(jsonl_lines)

        return self.write_output_files(all_conversations, output_dir)

    def generate_jsonl_from_bundles(self, message_bundles: List[ShareGPTMessage], filter_speaker=None):
        jsonl_lines = []
        i = 0
        while i <= len(message_bundles) - 4:
            speakers = [bundle[-1].from_user for bundle in [message_bundles[i + j] for j in range(4)]]

            # Filtering logic to skip over bundles that don't match the filter speaker
            if filter_speaker and filter_speaker != speakers[3]:
                i += 1
                continue

            if speakers[0] == speakers[2] and speakers[1] == speakers[3]:
                occurrence = [message_bundles[i + j] for j in range(4)]
                flattened_occurrence = [msg for bundle in occurrence for msg in bundle]
                jsonl_line = self.target_format_mapper(flattened_occurrence)
                if jsonl_line is not None:
                    jsonl_lines.append(jsonl_line)
                if self.no_overlap:
                    i += 4
                else:
                    i += 1
            else:
                i += 1
        return jsonl_lines

    def generate_jsonl_from_conversations(self, conversations: List[List[ShareGPTMessage]]) -> List[str]:
        jsonl_lines = []

        for convo in conversations:
            jsonl_line = self.target_format_mapper(convo)
            if jsonl_line is not None:
                jsonl_lines.append(jsonl_line)

        return jsonl_lines

    def write_output_files(self, all_lines, output_dir):
        random.shuffle(all_lines)
        current_time_millis = int(time.time() * 1000)
        print(current_time_millis)

        train_index = int(self.train_split * len(all_lines))
        validate_index = train_index + int(self.validate_split * len(all_lines))

        train_lines = all_lines if self.train_split == 1.0 else all_lines[:train_index]
        validate_lines = None if self.train_split == 1.0 else all_lines[train_index:validate_index + (1 if self.test_split == 0 and validate_index < len(all_lines) else 0)]
        test_lines = all_lines[validate_index:] if self.test_split > 0 else None

        ext = '.jsonl' if self.final_format == 'colab' else '.json'

        train_file_name = f"train_{current_time_millis}{ext}"
        validate_file_name = f"validate_{current_time_millis}{ext}"
        test_file_name = f"test_{current_time_millis}{ext}"

        if self.final_format == 'colab':
            self.write_jsonl_file(train_file_name, train_lines, output_dir)
            if validate_lines is not None:
                self.write_jsonl_file(validate_file_name, validate_lines, output_dir)
            if test_lines:
                self.write_jsonl_file(test_file_name, test_lines, output_dir)
        else:  # 'replicate' format
            self.write_json_file(train_file_name, train_lines, output_dir)
            if validate_lines is not None:
                self.write_json_file(validate_file_name, validate_lines, output_dir)
            if test_lines:
                self.write_json_file(test_file_name, test_lines, output_dir)

        return train_file_name, validate_file_name, test_file_name


def main():
    parser = argparse.ArgumentParser(description='Process chat data into train and validate JSON/JSONL files.')
    parser.add_argument('input_files', type=str, nargs='+', help='Paths to the input text files.')
    parser.add_argument('--strategy', type=lambda s: Strategy[s.upper()], choices=list(Strategy), default=Strategy.CONVERSATION, help='Strategy for grouping messages.')
    parser.add_argument('--target-format', type=str, choices=['llama-chat', 'sharegpt'], default='sharegpt', help='Target format for the output.')
    parser.add_argument('--filter-speaker', type=str, help='Filter by speaker name.')
    parser.add_argument('--mask', action='store_true', help='Mask the text.')
    parser.add_argument('--no-overlap', action='store_true', help='Generate non-overlapping examples.')
    parser.add_argument('--final-format', type=str, choices=['replicate', 'colab'], default='colab', help='Final format.')
    parser.add_argument('--train-split', type=float, default=1.0, help='Percentage of data for training.')
    parser.add_argument('--validate-split', type=float, help='Percentage of data for validation.')
    parser.add_argument('--source-type', type=str, choices=[parser.name for parser in Parser], default=Parser.WHATSAPP.name, help='Source platform and format of the input files.')
    parser.add_argument('--rename', action='append', help='Rename speakers, e.g., --rename "Self:gpt" --rename "(555) 123-4567:human"')
    parser.add_argument('--additional-blacklist', type=str, nargs='*', help='Additional regex patterns to blacklist messages. Messages matching any of these patterns will be excluded from processing. For example, --additional-blacklist "\btwilight\b" "\bromance\b".')
    args = parser.parse_args()

    rename_speakers = {original: new for pair in args.rename for original, new in [pair.split(":")]} if args.rename else {}

    # TODO: final_format and target_format are very confusing. Figure out a better way.
    if args.final_format == 'replicate' and args.target_format != 'llama-chat':
        raise ValueError("Final format 'replicate' is only supported for target format 'llama-chat'.")

    processor = ChatTrainingDataGenerator(
        target_format=args.target_format,
        strategy=args.strategy,
        train_split=args.train_split,
        validate_split=args.validate_split,
        mask=args.mask,
        no_overlap=args.no_overlap,
        final_format=args.final_format,
        additional_blacklist_patterns=args.additional_blacklist
    )

    files_with_settings = [{'file': file, 'parser': args.source_type, 'rename_speakers': rename_speakers, 'filter_speaker': args.filter_speaker} for file in args.input_files]

    train_file_name, validate_file_name, test_file_name = processor.process_files(files_with_settings)

    print(train_file_name)
    if validate_file_name:
        print(validate_file_name)
    if test_file_name:
        print(test_file_name)


if __name__ == "__main__":
    main()
