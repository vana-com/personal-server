from fastapi import APIRouter
from litellm import ModelResponse as LitellmCompletionResponse
from llama_cpp import (
    CreateCompletionResponse as LlamaCppCompletionResponse,
    CreateChatCompletionResponse as LlamaCppChatCompletionResponse,
)
from selfie.types.completion_requests import ChatCompletionRequest, CompletionRequest

from selfie.text_generation import completion

router = APIRouter()


@router.post("/chat/completions")
async def create_chat_completion(
        request: ChatCompletionRequest,
) -> LlamaCppChatCompletionResponse | LitellmCompletionResponse:
    return await completion(request)


# TODO can StreamingResponse's schema be defined?
@router.post("/completions")
async def create_completion(
        request: CompletionRequest,
) -> LlamaCppCompletionResponse | LitellmCompletionResponse:
    return await completion(request)
