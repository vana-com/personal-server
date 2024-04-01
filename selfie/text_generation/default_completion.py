from selfie.text_generation import completion
from selfie.types.completion_requests import CompletionRequest


async def default_completion(prompt):
    result = await completion(CompletionRequest(
        disable_augmentation=True,
        prompt=prompt,
        max_tokens=4096,
    ))

    # TODO: Responses should be consistent
    # Check if 'message' key exists and return the appropriate content
    if 'message' in result["choices"][0]:
        return result["choices"][0]["message"]["content"]
    else:
        return result["choices"][0]["text"]
