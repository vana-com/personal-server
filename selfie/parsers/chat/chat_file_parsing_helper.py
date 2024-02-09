import json
from pathlib import Path
from typing import Optional, Dict, List

from fastapi import UploadFile, HTTPException
from pydantic import BaseModel, field_validator

from selfie.parsers.chat import Parser


class ChatFileParserConfig(BaseModel):
    main_speaker: Optional[str] = None
    format: Optional[str] = None
    speaker_aliases: Optional[Dict[str, str]] = {}  # TODO: invert them

    @field_validator('format')
    def validate_format(cls, v: str):
        upper_v = v.upper()
        if upper_v is not None and upper_v not in Parser.__members__:
            raise ValueError(f"format must be one of: {list(Parser.__members__.keys())}")
        return upper_v


def save_file(f):
    path = Path(f.filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    f.file.seek(0)  # Not sure if this is needed
    file_content = f.file.read()
    path.write_bytes(file_content)
    return f.filename

def get_files_with_full_configs(files: List[UploadFile], parser_configs: List[ChatFileParserConfig]):
    parser_configs += [ChatFileParserConfig()] * (len(files) - len(parser_configs))
    saved_files = [save_file(f) for f in files]
    return [{"file": saved_file, "config": setting} for saved_file, setting in zip(saved_files, parser_configs)]

def get_files_with_configs(files: List[UploadFile], parser_configs: str):
    try:
        parser_configs: List[ChatFileParserConfig] = [
            ChatFileParserConfig(**config)
            for config in json.loads(parser_configs)
        ]
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid parser config")

    parser_configs += [ChatFileParserConfig()] * (len(files) - len(parser_configs))
    saved_files = [save_file(f) for f in files]
    files_with_configs = [{"file": saved_file, "config": setting} for saved_file, setting in zip(saved_files, parser_configs)]

    return files_with_configs


def delete_uploaded_files(files_with_configs):
    saved_files = [file_with_settings['file'] for file_with_settings in files_with_configs]
    for file in saved_files:
        Path(file).unlink()
