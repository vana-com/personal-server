from typing import Optional, Literal, List, ClassVar, Union, Dict, Any
from litellm import ModelResponse as LitellmCompletionResponse
from llama_cpp import (
    CreateCompletionResponse as LlamaCppCompletionResponse,
    CreateChatCompletionResponse as LlamaCppChatCompletionResponse,
)
from openai.types.chat import ChatCompletionMessage
from openai.types.completion_create_params import CompletionCreateParams, CompletionCreateParamsNonStreaming, CompletionCreateParamsStreaming
from openai.types.chat import CompletionCreateParams as ChatCompletionCreateParams
from pydantic import BaseModel, TypeAdapter, Extra

from sse_starlette import EventSourceResponse
# from typing_extensions import TypedDict

##########################


class Message(BaseModel):
    role: str
    content: str


class FunctionCall(BaseModel):
    name: str
    parameters: Optional[Dict[str, Any]] = None


class Tool(BaseModel):
    type: str
    function: Optional[FunctionCall] = None


class BaseCompletionRequest(BaseModel):
    # OpenAI parameters
    model: Optional[str] = None
    frequency_penalty: Optional[float] = 0.0
    logit_bias: Optional[Dict[int, float]] = None
    # logprobs: Optional[bool] = False
    max_tokens: Optional[int] = None
    # n: Optional[int] = 1
    presence_penalty: Optional[float] = 0.0
    response_format: Optional[Dict[str, str]] = None
    seed: Optional[int] = None
    stop: Optional[Union[str, List[str]]] = None
    stream: Optional[bool] = False
    temperature: Optional[float] = 1.0
    top_p: Optional[float] = 1.0
    tools: Optional[List[Tool]] = None
    tool_choice: Optional[Union[str, Dict[str, Any]]] = None
    # user: Optional[str] = None

    # Selfie parameters
    method: Optional[Literal["litellm", "llama.cpp", "transformers"]] = None
    api_base: Optional[str] = None
    api_key: Optional[str] = None
    disable_augmentation: Optional[bool] = False

    # Custom parameters, e.g. for a custom API
    class Config:
        extra = Extra.allow

    custom_params: ClassVar[List[str]] = ["method", "api_base", "api_key", "disable_augmentation"]

    def openai_params(self):
        return {
            k: v
            for k, v in self.model_dump().items()
            if k not in BaseCompletionRequest.custom_params and v is not None
        }

    def selfie_params(self):
        return {k: v for k, v in self.model_dump().items() if k in BaseCompletionRequest.custom_params and v is not None}

    def extra_params(self):
        """
        Returns all extra parameters (not OpenAI or Selfie parameters).
        :return: A dictionary of extra parameters
        """
        return {k: v for k, v in self.model_dump().items() if k not in self.model_fields.keys()}


class ChatCompletionRequest(BaseCompletionRequest):
    messages: List[Message]


class CompletionRequest(BaseCompletionRequest):
    prompt: Union[str, List[str]]
    # best_of: Optional[int] = None
    echo: Optional[bool] = None
    logprobs: Optional[int] = None
    # n: Optional[int] = None
    suffix: Optional[str] = None


class ChatCompletionResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: Optional[str]
    choices: List[Dict[str, Any]]
    usage: Dict[str, int]


##########################
# Unfortunately, these OpenAI typeddicts can't seem to be used by FastAPI for some reason

# Message = ChatCompletionMessage
# class BaseCompletionRequest(BaseModel):
#     model: Optional[str] = None
#     method: Optional[Literal["litellm", "llama.cpp", "transformers"]] = None
#     api_base: Optional[str] = None
#     api_key: Optional[str] = None
#
#     custom_params: ClassVar[List[str]] = ["method", "api_base", "api_key"]
#
#     def openai_params(self):
#         return {
#             k: v
#             for k, v in self.model_dump().items()
#             if k not in BaseCompletionRequest.custom_params and v is not None
#         }
#

# Union[CompletionCreateParamsNonStreaming, CompletionCreateParamsStreaming]

# class BaseCompletionRequest(TypedDict, total=False):
#     method: Optional[Literal["litellm", "llama.cpp", "transformers"]]
#     api_base: Optional[str]
#     api_key: Optional[str]
#
#
# class CompletionRequestNonStreaming(BaseCompletionRequest, CompletionCreateParamsNonStreaming, total=False):
#     pass
#
#
# class CompletionRequestStreaming(BaseCompletionRequest, CompletionCreateParamsStreaming, total=False):
#     pass
#
#
# class ChatCompletionRequestNonStreaming(BaseCompletionRequest, CompletionCreateParamsNonStreaming, total=False):
#     pass
#
#
# class ChatCompletionRequestStreaming(BaseCompletionRequest, CompletionCreateParamsStreaming, total=False):
#     pass


# CompletionRequest = TypeAdapter(Union[CompletionRequestNonStreaming, CompletionRequestStreaming])
# ChatCompletionRequest = TypeAdapter(Union[ChatCompletionRequestNonStreaming, ChatCompletionRequestStreaming])
# SelfieCompletionRequest = TypeAdapter(Union[CompletionRequestNonStreaming, CompletionRequestStreaming, ChatCompletionRequestNonStreaming, ChatCompletionRequestStreaming])
#
#
# class RequestHandler:
#     def __init__(self, request: SelfieCompletionRequest):
#         self.request = request
#
#     def openai_params(self):
#         # Extract and return the relevant parameters for the OpenAI API call
#         # Note: Adjust the logic here as per your requirement
#         return {k: v for k, v in self.request.items() if v is not None and k not in ["method", "api_base", "api_key"]}


SelfieCompletionRequest = CompletionRequest | ChatCompletionRequest
SelfieCompletionResponse = LlamaCppCompletionResponse | LlamaCppChatCompletionResponse | LitellmCompletionResponse | EventSourceResponse
