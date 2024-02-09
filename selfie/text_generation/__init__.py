import logging

from selfie.text_generation.retrieval_augmentation import augment
from selfie.types.completion_requests import SelfieCompletionResponse, ChatCompletionRequest, CompletionRequest
from selfie.text_generation.generation import completion as generate_text

logger = logging.getLogger(__name__)


async def completion(
        request: CompletionRequest | ChatCompletionRequest
) -> SelfieCompletionResponse:
    logger.debug(f"Received completion request: {request}")
    if not request.disable_augmentation:
        logger.debug("Augmenting request")

        async def augmentation_completion(prompt):
            # Create a request with the same parameters as the original request, except for the inference parameters.
            simple_result = await completion(ChatCompletionRequest(
                **{
                    **request.extra_params(),
                    **request.selfie_params(),
                    'disable_augmentation': True,
                    # TODO: Add a system message?
                    'messages': [{"content": prompt, "role": "user"}],
                    'max_tokens': 512,
                },
            ))

            # TODO: test whether this is necessary
            if isinstance(simple_result, dict):
                return simple_result["choices"][0]["message"]["content"]
            else:
                return simple_result.choices[0].message.content

        await augment(request, augmentation_completion)

        logger.debug(f"Augmented request: {request}")
    else:
        logger.debug("Skipping augmentation")

    return await generate_text(request)
