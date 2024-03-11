from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

from selfie.database import DataManager
from selfie.embeddings import DataIndex
from selfie.parsers.chat import ChatFileParser

router = APIRouter()


class UnindexDocumentsRequest(BaseModel):
    document_ids: List[int] = []


class IndexDocumentsRequest(BaseModel):
    is_chat: bool = False
    document_ids: List[int] = []


class DeleteDocumentsRequest(BaseModel):
    document_ids: List[int] = []


@router.get("/documents")
async def get_documents():
    return DataManager().get_documents()


@router.delete("/documents")
async def index_documents(request: DeleteDocumentsRequest):
    await DataManager().remove_documents([int(document_id) for document_id in request.document_ids])
    return {"message": "Documents removed successfully"}


@router.delete("/documents/{document_id}")
async def delete_data_source(document_id: int, delete_indexed_data: bool = True):
    await DataManager().remove_document(document_id, delete_indexed_data)
    return {"message": "Document removed successfully"}


@router.post("/documents/unindex")
async def unindex_documents(request: UnindexDocumentsRequest):
    await DataIndex("n/a").delete_documents_with_source_documents(request.document_ids)
    return {"message": "Document unindexed successfully"}


@router.post("/documents/index")
async def index_documents(request: IndexDocumentsRequest):
    is_chat = request.is_chat
    document_ids = request.document_ids

    manager = DataManager()
    parser = ChatFileParser()

    # TODO: figure out what to do about this
    speaker_aliases = {}

    return [
        await manager.index_document(manager.get_document(document_id),
                                     lambda document: DataIndex.map_share_gpt_data(
                                         parser.parse_document(
                                             document.content,
                                             None,
                                             speaker_aliases,
                                             False,
                                             document.id
                                         ).conversations,
                                         # source=document.source.name,
                                         source_document_id=document.id
                                     ) if is_chat else None)
        for document_id in document_ids
    ]

# @app.delete("/documents/{document-id}")
# async def delete_data_source(document_id: int):
#     DataSourceManager().remove_document(document_id)
#     return {"message": "Document removed successfully"}
