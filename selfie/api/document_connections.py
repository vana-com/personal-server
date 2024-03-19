import base64
import json
from typing import Any, Dict
from urllib.parse import quote

from fastapi import APIRouter, Request, UploadFile, Form, HTTPException, Depends, Body
from pydantic import BaseModel, Field

from selfie.connectors.factory import ConnectorFactory
from selfie.database import DataManager, DocumentModel
from selfie.embeddings import DataIndex

router = APIRouter(tags=["Data Management"])


class DocumentConnectionRequest(BaseModel):
    connector_id: str = Field(..., description="The ID of the connector to use for creating the document connection.")
    configuration: Dict[str, Any] = Field(..., description="The configuration object for the document connection.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "connector_id": "whatsapp",
                "configuration": {
                    "files": ["data:text/plain;name=example.txt;base64,SGVsbG8gV29ybGQ="]
                }
            }
        }
    }


class DocumentConnectionResponse(BaseModel):
    message: str = Field(..., description="A message indicating the status of the document connection creation.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "message": "Document connection created successfully"
            }
        }
    }


async def file_to_data_uri(file: UploadFile):
    encoded = base64.b64encode(await file.read()).decode()
    safe_filename = quote(file.filename)
    return f"data:{file.content_type};name={safe_filename};base64,{encoded}"


# Replace placeholders in configuration with data URIs
async def replace_file_references_with_files(configuration, form_data):
    async def replace_placeholder(value):
        if isinstance(value, str) and value.startswith("file-"):
            if value in form_data:
                return await file_to_data_uri(form_data[value])
        return value

    async def process_value(value):
        if isinstance(value, (dict, list)):
            if isinstance(value, dict):
                for k, v in value.items():
                    value[k] = await process_value(v)
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    value[i] = await process_value(item)
        else:
            return await replace_placeholder(value)
        return value

    for key, val in configuration.items():
        configuration[key] = await process_value(val)

    # Warning: Do not print configuration unless you truncate the data URIs
    # print("Processed configuration:", configuration)


async def parse_create_document_connection_request(request: Request):
    if request.headers['content-type'].startswith('multipart/form-data'):
        form_data = await request.form()
        connector_id = form_data.get("connector_id")
        configuration = json.loads(form_data.get("configuration"))
        await replace_file_references_with_files(configuration, form_data)
    elif request.headers['content-type'] == 'application/json':
        json_data = await request.json()
        connector_id = json_data.get("connector_id")
        configuration = json_data.get("configuration")
    else:
        raise HTTPException(status_code=400, detail="Unsupported Content Type")

    return connector_id, configuration


@router.post("/document-connections",
             description="""Create a new document connection using the specified connector and configuration.

The request can be sent as multipart/form-data or application/json. Because browsers tend to limit the size of data URIs, it is recommended to use multipart/form-data for large files.

### Using multipart/form-data

For multipart/form-data, the connector_id and configuration should be provided as form fields. The configuration object should contain placeholders for file references, which will be replaced with data URIs from corresponding file fields in the request body.

For example, the following form fields can be used to create a document connection:

    connector_id: whatsapp
    configuration: {"files": ["file-0"]}
    file-0: <example.txt>

### Using application/json

For application/json, the connector_id and configuration should be provided in the request body. The configuration object should contain files as data URIs.

For example, the following JSON can be used to create a document connection:

    {
        "connector_id": "whatsapp",
        "configuration": {
            "files": ["data:text/plain;name=example.txt;base64,SGVsbG8gV29ybGQ="]
        }
    }
""",
             openapi_extra={
                 "requestBody": {
                     "content": {
                         "application/json": {
                             "schema": DocumentConnectionRequest.schema()
                         },
                         "multipart/form-data": {
                             "schema": {
                                 "type": "object",
                                 "properties": {
                                     "connector_id": {"type": "string"},
                                     "configuration": {"type": "string"}
                                 },
                                 "required": ["connector_id", "configuration"],
                                 "patternProperties": {
                                     "^file-\\d+$": {
                                         "type": "string",
                                         "format": "binary"
                                     }
                                 }
                             },
                             "examples": {
                                 "example1": {
                                     "summary": "Example 1",
                                     "value": """connector_id: whatsapp
configuration: {"files": ["file-0"]}
file-0: <example.txt>
"""
                                 }
                             }
                         }
                     }
                 }
             })
# request_body=DocumentConnectionRequest)
async def create_document_connection(
        request: Request,
        # document_connection_request: DocumentConnectionRequest = Body(..., description="The document connection request."),
        parsed_data: tuple = Depends(parse_create_document_connection_request)
) -> DocumentConnectionResponse:
    connector_id, configuration = parsed_data
    connector_instance = ConnectorFactory.get_connector(connector_name=connector_id)
    connector_instance.validate_configuration(configuration=configuration)
    document_dtos = connector_instance.load_document(configuration)

    if len(document_dtos) > 0:
        # Save document connection
        document_connection = DataManager().add_document_connection(
            connector_id,
            configuration,
        )
        # Save documents
        for document_dto in document_dtos:
            document_model = DocumentModel.create(
                document_connection=document_connection,
                content=document_dto.content,
                content_type=document_dto.content_type,
                name=document_dto.name,
                size=document_dto.size
            )
            document_dto.id = document_model.id
            document_dto.document_connection_id = document_connection

        embedding_documents = connector_instance.transform_for_embedding(configuration, document_dtos)
        # Save embedding_documents to Vector DB
        await DataIndex("n/a").index(embedding_documents, extract_importance=False)

    return DocumentConnectionResponse(message="Document connection created successfully")
