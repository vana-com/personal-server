from fastapi import APIRouter
from litellm import ModelResponse as LitellmCompletionResponse
from llama_cpp import (
    CreateCompletionResponse as LlamaCppCompletionResponse,
    CreateChatCompletionResponse as LlamaCppChatCompletionResponse,
)
from llama_index.core import VectorStoreIndex, ServiceContext
from llama_index.core.vector_stores import VectorStoreQuery
from llama_index.llms.openai_like import OpenAILike

from selfie.embeddings.TxtaiVectorStore import TxtaiVectorStore
from selfie.embeddings import DataIndex
from selfie.types.completion_requests import ChatCompletionRequest, CompletionRequest

from selfie.text_generation import completion

router = APIRouter(tags=["Completions"])


@router.post("/chat/completions",
             description="""
             Creates a response for the given conversation in [the style of OpenAI](https://platform.openai.com/docs/api-reference/chat/create).
             """)
async def create_chat_completion(
        request: ChatCompletionRequest,
) -> LlamaCppChatCompletionResponse | LitellmCompletionResponse:
    return await completion(request)


# TODO can StreamingResponse's schema be defined?
@router.post("/completions",
                description="""
                Creates a response for the given prompt in [the style of OpenAI](https://platform.openai.com/docs/api-reference/completions/create).
                """)
async def create_completion(
        request: CompletionRequest,
) -> LlamaCppCompletionResponse | LitellmCompletionResponse:
    return await completion(request)
