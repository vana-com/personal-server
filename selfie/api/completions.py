from fastapi import APIRouter
from litellm import ModelResponse as LitellmCompletionResponse
from llama_cpp import (
    CreateCompletionResponse as LlamaCppCompletionResponse,
    CreateChatCompletionResponse as LlamaCppChatCompletionResponse,
)
from selfie.types.completion_requests import ChatCompletionRequest, CompletionRequest

from selfie.text_generation import completion

# router = APIRouter(tags=["OpenAI"])
router = APIRouter(tags=["Completions", "OpenAI"])


@router.post("/chat/completions",
             # tags=["OpenAI"],
             # summary="Create chat completion",
             description="""
             Creates a response for the given conversation in [the style of OpenAI](https://platform.openai.com/docs/api-reference/chat/create).
             """)
async def create_chat_completion(
        request: ChatCompletionRequest,
) -> LlamaCppChatCompletionResponse | LitellmCompletionResponse:
    return await completion(request)


# TODO can StreamingResponse's schema be defined?
@router.post("/completions",
                # tags=["OpenAI"],
                # summary="Create completion",
                description="""
                Creates a response for the given prompt in [the style of OpenAI](https://platform.openai.com/docs/api-reference/completions/create).
                """)
async def create_completion(
        request: CompletionRequest,
) -> LlamaCppCompletionResponse | LitellmCompletionResponse:
    return await completion(request)
