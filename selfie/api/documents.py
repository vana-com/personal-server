from typing import List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from selfie.embeddings import ScoredEmbeddingDocumentModel
from selfie.database import DataManager
from selfie.embeddings import DataIndex

router = APIRouter()


class UnindexDocumentsRequest(BaseModel):
    document_ids: List[str] = []


class IndexDocumentsRequest(BaseModel):
    is_chat: bool = False
    document_ids: List[str] = []


class DeleteDocumentsRequest(BaseModel):
    document_ids: List[str] = []


class FetchedDocument(BaseModel):
    id: int = Field(..., description="The unique identifier of the document")
    name: str = Field(..., description="The name of the document")
    size: int = Field(..., description="The size of the document")
    created_at: str = Field(..., description="The timestamp of the document creation")
    updated_at: str = Field(..., description="The timestamp of the document update")
    content_type: str = Field(..., description="The content type of the document")
    connector_name: str = Field(..., description="The name of the connector")

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": 1,
                "name": "example.txt",
                "size": 1024,
                "created_at": "2024-03-11T18:33:04.733583",
                "updated_at": "2024-03-11T18:33:04.733590",
                "content_type": "text/plain",
                "connector_name": "whatsapp",
            }
        }
    }


@router.get("/documents",
            tags=["Data Management"])
async def get_documents() -> List[FetchedDocument]:
    return DataManager().get_documents()


@router.delete("/documents",
               tags=["Data Management"],
               description="Remove multiple documents by their IDs.",
               status_code=204)
async def delete_documents(request: DeleteDocumentsRequest):
    await DataManager().remove_documents([int(document_id) for document_id in request.document_ids])


@router.delete("/documents/{document_id}",
               tags=["Data Management"],
               description="Remove a document by its ID.",
               status_code=204)
async def delete_document(document_id: int, delete_indexed_data: Optional[bool] = True):
    await DataManager().remove_document(document_id, delete_indexed_data)


class SearchDocumentsResponse(BaseModel):
    query: str = Field(..., description="The search query")
    total_results: int = Field(..., description="The total number of documents found")
    average_score: float = Field(..., description="The mean relevance score of the documents")
    documents: List[ScoredEmbeddingDocumentModel] = Field(..., description="The documents found")
    summary: Optional[str] = Field(None, description="A summary of the search results")

    model_config = {
        "json_schema_extra": {
            "example": {
                "query": "What is the meaning of life?",
                "total_results": 1,
                "average_score": 0.4206031938249788,
                "documents": [
                    {
                        "id": 1,
                        "text": "The meaning of life is 42.",
                        "source": "whatsapp",
                        "timestamp": "2023-03-12T11:35:00Z",
                        "created_timestamp": "2024-03-11T18:33:04.733583",
                        "updated_timestamp": "2024-03-11T18:33:04.733590",
                        "source_document_id": 3,
                        "score": 0.4206031938249788,
                        "relevance": 0.08712080866098404,
                        "recency": 0.4720855789889736,
                        "importance": None,
                    },
                ],
                "summary": "The meaning of life is 42."
            }
        }
    }


@router.get("/documents/search",
            tags=["Search"],
            description="Search for embedding documents that most closely match a query.")
async def search_documents(
        query: str,
        limit: Optional[int] = Query(3, ge=1, le=100, description="Maximum number of documents to fetch"),
        min_score: Optional[float] = Query(0.4, ge=0.0, le=1.0, description="Minimum score for embedding documents"),
        include_summary: Optional[bool] = Query(False, description="Include a summary of the search results"),
        relevance_weight: Optional[float] = Query(1.0, le=1.0, ge=0.0, description="Weight for relevance in the scoring algorithm"),
        recency_weight: Optional[float] = Query(1.0, le=1.0, ge=0.0, description="Weight for recency in the scoring algorithm"),
        importance_weight: Optional[float] = Query(0, le=1.0, ge=0.0, description="**Importance scores are currently not calculated, so this weight has no effect!** Weight for document importance in the scoring algorithm.")
) -> SearchDocumentsResponse:
    result = await DataIndex("n/a").recall(
        topic=query,
        limit=limit,
        min_score=min_score,
        include_summary=include_summary,
        relevance_weight=relevance_weight,
        recency_weight=recency_weight,
        importance_weight=importance_weight,
    )

    return SearchDocumentsResponse(
        query=query,
        total_results=len(result["documents"]),
        average_score=result["mean_score"],
        documents=result["documents"],
        summary=result["summary"] if include_summary else None
    )
