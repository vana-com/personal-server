from typing import Optional, Literal, List, ClassVar, Union, Dict, Any
from pydantic import BaseModel, TypeAdapter, Extra, Field

from litellm import ModelResponse as LitellmCompletionResponse
from llama_cpp import (
    CreateCompletionResponse as LlamaCppCompletionResponse,
    CreateChatCompletionResponse as LlamaCppChatCompletionResponse,
)
from openai.types.chat import ChatCompletionMessage
from openai.types.completion_create_params import CompletionCreateParams, CompletionCreateParamsNonStreaming, CompletionCreateParamsStreaming
from openai.types.chat import CompletionCreateParams as ChatCompletionCreateParams

from sse_starlette import EventSourceResponse
# from typing_extensions import TypedDict

##########################


class Message(BaseModel):
    role: str = Field(..., description="The role of the message sender, e.g., 'system', 'user', or 'assistant'")
    content: str = Field(..., description="The content of the message")


class FunctionCall(BaseModel):
    name: str = Field(..., description="The name of the function to call")
    parameters: Optional[Dict[str, Any]] = Field(None, description="The parameters to pass to the function")


class Tool(BaseModel):
    type: str = Field(..., description="The type of the tool")
    function: Optional[FunctionCall] = Field(None, description="The function to call when using the tool")


class BaseCompletionRequest(BaseModel):
    # OpenAI parameters
    model: Optional[str] = Field(None, description="ID of the model to use for completion")
    frequency_penalty: Optional[float] = Field(0.0, description="Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.")
    logit_bias: Optional[Dict[int, float]] = Field(None, description="Modify the likelihood of specified tokens appearing in the completion.")
    # logprobs: Optional[bool] = False
    max_tokens: Optional[int] = Field(None, description="The maximum number of tokens to generate in the completion.")
    # n: Optional[int] = 1
    presence_penalty: Optional[float] = Field(0.0, description="Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.")
    response_format: Optional[Dict[str, str]] = Field(None, description="An object specifying the format that the model must output.")
    seed: Optional[int] = Field(None, description="If specified, the returned completion will be deterministic. Generated tokens will be the same for each request with the same seed.")
    stop: Optional[Union[str, List[str]]] = Field(None, description="Up to 4 sequences where the API will stop generating further tokens.")
    stream: Optional[bool] = Field(False, description="If set, partial completion results will be sent as they become available.")
    temperature: Optional[float] = Field(1.0, description="What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.")
    top_p: Optional[float] = Field(1.0, description="An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass.")
    tools: Optional[List[Tool]] = Field(None, description="A list of tools the model may call.")
    tool_choice: Optional[Union[str, Dict[str, Any]]] = Field(None, description="Controls which (if any) function is called by the model. Options are 'none', 'auto', or a specific function.")
    # user: Optional[str] = None

    # Selfie parameters
    method: Optional[Literal["litellm", "llama.cpp", "transformers"]] = Field(None, description="The method to use for completion, e.g., 'litellm', 'llama.cpp', or 'transformers'.")
    api_base: Optional[str] = Field(None, description="The base URL for the API")
    api_key: Optional[str] = Field(None, description="The API key to use for authentication")
    disable_augmentation: Optional[bool] = Field(False, description="Whether to disable data augmentation during completion")

    class Config:
        # Allow custom parameters, e.g. for a custom API
        extra = Extra.allow
        model_config = {
            "json_schema_extra": {
                "example": {
                    "method": "litellm",
                    "model": "gpt-3.5-turbo",
                    "api_key": "your-api-key",
                    "prompt": "Hello, how are you?",
                    "max_tokens": 50,
                    "temperature": 0.8,
                }
            }
        }


class ChatCompletionRequest(BaseCompletionRequest):
    messages: List[Message] = Field(..., description="A list of messages comprising the conversation so far.")

    custom_params: ClassVar[List[str]] = ["method", "api_base", "api_key", "disable_augmentation"]

    def openai_params(self):
        return {
            k: v
            for k, v in self.model_dump().items()
            if k not in self.custom_params and v is not None
        }

    def selfie_params(self):
        return {k: v for k, v in self.model_dump().items() if k in self.custom_params and v is not None}

    def extra_params(self):
        """
        Returns all extra parameters (not OpenAI or Selfie parameters).
        :return: A dictionary of extra parameters
        """
        return {k: v for k, v in self.model_dump().items() if k not in self.model_fields.keys()}

    model_config = {
        "json_schema_extra": {
            "example": {
                "method": "litellm",
                "model": "gpt-3.5-turbo",
                "api_key": "your-api-key",
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "What is the capital of France?"}
                ],
                "max_tokens": 50,
                "temperature": 0.8,
            }
        }
    }


class CompletionRequest(BaseCompletionRequest):
    prompt: Union[str, List[str]] = Field(..., description="The prompt(s) to generate completions for. Can be a string or a list of strings.")
    # best_of: Optional[int] = None
    echo: Optional[bool] = Field(None, description="Whether to echo the prompt in the response.")
    logprobs: Optional[int] = Field(None, description="Include the log probabilities on the logprobs most likely tokens, as well the chosen tokens. So for example, if logprobs is 10, the API will return a list of the 10 most likely tokens. If logprobs is supplied, the API will always return the logprob of the sampled token, so there may be up to logprobs+1 elements in the response.")
    # n: Optional[int] = None
    suffix: Optional[str] = Field(None, description="The suffix that comes after a completion of inserted text.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "method": "litellm",
                "model": "gpt-3.5-turbo",
                "api_key": "your-api-key",
                "prompt": "Once upon a time",
                "max_tokens": 50,
                "temperature": 0.8,
            }
        }
    }


# class ChatCompletionResponse(BaseModel):
#     id: str = Field(..., description="The ID of the completion")
#     object: str = Field('chat.completion', description="The object type, e.g., 'chat.completion'")
#     created: int = Field(..., description="The timestamp of the completion creation")
#     model: Optional[str] = Field(None, description="The model used for the completion")
#     choices: List[Dict[str, Any]] = Field(..., description="The choices of completions")
#     usage: Dict[str, int] = Field(..., description="The usage of the completion")
#


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
