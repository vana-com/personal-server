import logging
import json
import os

import litellm
from fastapi import HTTPException
from sse_starlette import EventSourceResponse
from txtai.pipeline import GenerationFactory, LLM

from selfie.config import get_app_config
from selfie.types.completion_requests import SelfieCompletionResponse, CompletionRequest, ChatCompletionRequest

logger = logging.getLogger(__name__)

config = get_app_config()


async def completion(request: CompletionRequest | ChatCompletionRequest) -> SelfieCompletionResponse:
    logger.debug(f"Handling a completion request: {request}")

    if request.model == "":
        request.model = None

    chat_mode = isinstance(request, ChatCompletionRequest)

    if request.method and request.method is not "litellm" and request.api_base:
        logger.warning("Ignoring api_base because method is not litellm")
        method = request.method
    elif (request.method is "litellm" and request.model is None) or (request.method is None and request.api_base is not None):
        request.method = "litellm"
        request.model = config.hosted_model if request.model is None else request.model
        method = "litellm"
    elif request.method is None and request.model:
        method = GenerationFactory.method(request.model, request.method)
    elif request.method is None:
        method = 'llama.cpp'
    else:
        method = request.method

    open_ai_params = request.openai_params()

    logger.debug(f"OpenAI params: {open_ai_params}")

    if method == "llama.cpp":
        model = request.model or config.local_model
        logger.info(f"Using model {model}")
        llm = LLM(
            verbose=config.verbose,
            path=model,
            method="llama.cpp",
            n_ctx=8192,
            n_gpu_layers=-1 if config.gpu else 0,
            # Special-case models whose embedded prompt templates do not work well
            **({ 'chat_format': "mistrallite"} if "mistral" in model or "mixtral" in model else {})
        ).generator.llm

        completion_fn = (llm.create_chat_completion if chat_mode else llm.create_completion)

        result = completion_fn(**open_ai_params)

        if request.stream:
            logger.debug("Streaming response")
            return EventSourceResponse(
                # [logger.debug(f"Sending event: {json.dumps(item)}"), {"data": json.dumps(item)}][1] for item in result
                {"data": json.dumps(item)} for item in result
            )
    elif method == "litellm":
        logger.info(f"Using model {request.model or 'litellm default'}")
        if not chat_mode:
            open_ai_params["messages"] = [{"content": open_ai_params["prompt"], "role": "user"}]
            del open_ai_params["prompt"]

        if "temperature" in open_ai_params and open_ai_params["temperature"] == 0.0:
            open_ai_params["temperature"] = 0.0000001

        result = litellm.completion(**open_ai_params, base_url=request.api_base, api_key=request.api_key or "none")
        if request.stream:
            logger.debug("Streaming response")
            return EventSourceResponse(
                # [logger.debug(f"Sending event: {item.model_dump()}"), {"data": json.dumps(item.model_dump())}][1] for item in result
                {"data": json.dumps(item.model_dump())} for item in result
            )
    elif method == "transformers":  # TODO: Check GPU support
        # # TODO: TL;DR this seems like way too much. Look for another library.
        # model = request.model or default_local_gpu_model
        # logger.info(f"Using model {model}")
        #
        # import torch
        # import transformers
        #
        # device = "cuda:0" if torch.cuda.is_available() else "cpu"
        #
        # from transformers import TextStreamer
        #
        # llm = LLM(
        #     path=model,
        #     method="transformers",
        #     device_map="auto",
        #     **({
        #         'quantization_config': transformers.GPTQConfig(bits=4, use_exllama=False)
        #     } if device is "cpu" else {})
        # )
        #
        # tokenizer = llm.generator.llm.pipeline.tokenizer
        #
        # # TODO: needs work
        # def transform_openai_params(open_ai_params: Dict[str, Any]) -> Dict[str, Any]:
        #     filtered_params = {key: value for key, value in open_ai_params.items()
        #                        if key not in
        #                        ['model', 'prompt', 'stream', 'logit_bias', 'max_tokens']} # TODO not ideal
        #     if chat_mode:
        #         filtered_params['text'] = tokenizer.apply_chat_template(request.messages, tokenize=False, add_generation_prompt=True)
        #         del filtered_params['messages']
        #     else:
        #         filtered_params['text'] = request.prompt
        #
        #     del filtered_params['frequency_penalty']
        #     del filtered_params['presence_penalty']
        #
        #     if request.stream:
        #         filtered_params['streamer'] = TextStreamer(tokenizer, skip_prompt=True)
        #
        #     return filtered_params
        #
        # id = _generate_id()
        # created = round(datetime.now().timestamp())
        # transformed_openai_params = transform_openai_params(open_ai_params)
        #
        # def make_response(text: str, finish_reason: str = None):
        #     prompt_tokens = tokenizer(transformed_openai_params['text'], return_tensors='pt')['input_ids'].size(1)
        #     completion_tokens = tokenizer(text, return_tensors='pt')['input_ids'].size(1)
        #
        #     return {
        #         'id': id,
        #         'object': 'chat.completion' if chat_mode else 'text_completion',
        #         'model': model,
        #         'created': created,
        #         'choices': [
        #             {
        #                 **({
        #                        "message": {
        #                            "content": text,
        #                            "role": "assistant"
        #                        }
        #                    } if chat_mode else {
        #                     "text": text,
        #                 }),
        #                 "index": 0,
        #                 "logprobs": None,
        #                 "finish_reason": finish_reason
        #             }
        #         ],
        #         'usage': {'prompt_tokens': prompt_tokens, 'completion_tokens': completion_tokens, 'total_tokens': prompt_tokens + completion_tokens}
        #     }
        #
        # generation = llm(**transformed_openai_params)
        # # print(f'Generation: {generation}')
        # if request.stream:
        #     return EventSourceResponse(
        #         (*({"data": json.dumps(make_response(item))} for item in generation),
        #           {"data": json.dumps(make_response("", finish_reason="stop"))})
        #     )
        #
        # result = make_response(generation, "stop")

        # # TODO: Make error response OpenAI-compatible
        raise HTTPException(status_code=501, detail="Method not yet implemented")
    else:
        # TODO: don't use HTTPException here
        raise HTTPException(status_code=400, detail="Invalid method")

    logger.debug(f"Result: {result}")

    return result
