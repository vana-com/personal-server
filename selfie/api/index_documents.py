from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, Form

from selfie.api.data_sources import DataLoaderRequest
from selfie.parsers.chat import ChatFileParser
from selfie.parsers.chat.chat_file_parsing_helper import get_files_with_configs, delete_uploaded_files
from selfie.embeddings import DataIndex
from selfie.embeddings.document_types import EmbeddingDocumentModel

from llama_index.core.node_parser.text import SentenceSplitter
from datetime import datetime
import importlib

router = APIRouter()

from selfie.config import get_app_config

config = get_app_config()

@router.get("/index_documents")
async def get_documents(offset: int = 0, limit: int = 10):
    return await DataIndex("n/a").get_documents(offset=offset, limit=limit)


@router.get("/index_documents/summary")
async def get_index_documents_summary(topic: str, limit: Optional[int] = 5, min_score: Optional[float] = None, include_summary: Optional[bool] = True):
    result = await DataIndex("n/a").recall(topic, limit=limit, min_score=min_score, include_summary=include_summary)
    return {
        "summary": result["summary"],
        "score": result["mean_score"],
        "documents": result["documents"],
    }


@router.post("/index_documents")
async def create_index_document(document: EmbeddingDocumentModel):
    return (await DataIndex("n/a").index([document]))[0]


@router.get("/index_documents/{document_id}")
async def get_index_document(document_id: int):
    return await DataIndex("n/a").get_document(document_id)


@router.put("/index_documents/{document_id}")
async def update_index_document(document_id: int, document: EmbeddingDocumentModel):
    await DataIndex("n/a").update_document(document_id, document)
    return {"message": "Document updated successfully"}


@router.delete("/index_documents/{document_id}")
async def delete_index_document(document_id: int):
    # Sometimes self.embeddings.save() errors on "database is locked", bricks it
    # raise HTTPException(status_code=501, detail="Not implemented")
    DataIndex("n/a").delete_document(document_id)
    return {"message": "Document deleted successfully"}


@router.delete("/index_documents")
async def delete_index_documents():
    DataIndex("n/a").delete_all()
    return {"message": "All documents deleted successfully"}


# TODO: Deprecate this endpoint, it should be not be allowed to embed documents that are not tracked
@router.post("/index_documents/llama-hub-loader")
async def load_data(request: DataLoaderRequest):
    # TODO: extract document metadata from request?

    # Adapted from:
    # https://docs.llamaindex.ai/en/stable/examples/low_level/oss_ingestion_retrieval.html#build-an-ingestion-pipeline-from-scratch
    module_name, class_name = request.loader_module.rsplit(".", 1)
    module = importlib.import_module(module_name)
    loader_class = getattr(module, class_name)

    loader = loader_class(*request.constructor_args, **request.constructor_kwargs)

    documents = loader.load_data(*request.load_data_args, **request.load_data_kwargs)

    print(documents)

    text_parser = SentenceSplitter(
        chunk_size=config.embedding_chunk_size,
        chunk_overlap=config.embedding_chunk_overlap,
        # separator=" ",
    )

    text_chunks = []
    # maintain relationship with source doc index, to help inject doc metadata in (3)
    doc_idxs = []
    for doc_idx, doc in enumerate(documents):
        cur_text_chunks = text_parser.split_text(doc.text)
        text_chunks.extend(cur_text_chunks)
        doc_idxs.extend([doc_idx] * len(cur_text_chunks))

    embedding_documents = []
    for idx, text_chunk in enumerate(text_chunks):
        src_doc = documents[doc_idxs[idx]]
        document = EmbeddingDocumentModel(
            text=text_chunk,
            # source=request.loader_module,
            # importance=0.0,
            # timestamp=datetime.strptime(src_doc.metadata['last_modified'], "%Y-%m-%d"),
            # use last_modified if available, otherwise use current time
            timestamp=datetime.strptime(src_doc["last_modified"], "%Y-%m-%d")
            # source_document_id=src_doc["id"]
            if "last_modified" in src_doc
            else datetime.now(),
        )

        embedding_documents.append(document)

    return {"documents": await DataIndex("n/a").index(embedding_documents, extract_importance=False)}


@router.post("/index_documents/chat-processor")
async def process_chat_files(
        character_name: str,
        files: List[UploadFile] = File(..., description="Upload chat files here."),
        parser_configs: str = Form(
            "[]",
            description="JSON string of parser configurations. Format can be whatsapp, google, discord. Example: "
                        + '[{"main_speaker": "Alice", "format": "whatsapp", '
                        + '"speaker_aliases": {"alicex": "Alice", "bobby": "Bob"}}]',
        ),
        extract_importance: bool = False,
):
    parser = ChatFileParser()
    data_index = DataIndex(character_name)

    files_with_settings = get_files_with_configs(files, parser_configs)

    documents = []
    new_document_count = 0
    for file_with_settings in files_with_settings:
        file_data = parser.parse_file(
            file_with_settings["file"],
            file_with_settings["config"].format,
            file_with_settings["config"].speaker_aliases,
        )

        mapped_documents = DataIndex.map_share_gpt_data(
            file_data.conversations, file_with_settings["file"].split("/")[-1]
        )

        file_documents = await data_index.index(mapped_documents, extract_importance)
        new_document_count += len(file_documents)
        documents.extend(file_documents)

    delete_uploaded_files(files_with_settings)

    return {
        "success": True,
        "num_documents": len(documents),
        "num_new_documents": new_document_count,
    }
