import logging

from selfie.embeddings import DataIndex
from selfie.types.completion_requests import CompletionRequest, ChatCompletionRequest, Message

logger = logging.getLogger(__name__)


# TODO: add a token budget for the augmentation
async def augment(request: CompletionRequest | ChatCompletionRequest, completion):
    chat_mode = isinstance(request, ChatCompletionRequest)
    data_index = DataIndex("n/a", completion=completion)

    # Step 1: Retrieval

    if chat_mode:
        # Provide the last 15 user messages as context
        context = ""
        i = len(request.messages) - 1
        while i >= 0 and len(context) < 512 and len(context.split("\n")) < 15:
            message = request.messages[i]
            if message.role != "system":
                context = f"{message.content}\n{context}"
            i -= 1
    else:
        context = request.prompt

    # Strategy A: use the last user message as the query
    # logger.debug("Using strategy: use the last user message as the query")
    # last_user_message = next(
    #     (
    #         message
    #         for message in reversed(request.messages)
    #         if message.role == "user"
    #     ),
    #     None,
    # )
    #
    # recall_query = last_user_message.content if last_user_message else ""
    # End strategy

    # Strategy B: generate a query for relevant context based on the conversation history
    logger.debug("Using strategy: generate a query for relevant context based on the conversation history")
    prompt_prefix = f"Given only the conversation snippet below, what is the most salient topic whose answer would be relevant in continuing the conversation? For example, if the conversation was about fire and moved on to scuba diving, you should answer 'scuba diving, ocean, favorite hobbies' (only an example!). State your answer without explanation, your entire response will be fed directly into a query engine:"
    prompt = f"{prompt_prefix}:\n\n{context}\nSalient query: "
    logger.debug(f"Query generation prompt: {prompt}")
    topic = (await completion(prompt)).strip()
    # End strategy

    logger.debug(f"Generated query: {topic}")
    documents = await data_index.recall(topic, context)

    # Step 2: Augmentation
    # Augment the request by prepending the document summary to the system message.
    # Find the first system message and insert the document summary at the end. If there isn't one,
    # insert a new system message at the beginning.
    system_message = f"Here are some things you know, that may or may not be relevant to the current conversation. Do not assume that you are currently talking to any named individuals. Use this knowledge if and only if you are 90%+ convinced that it is relevant to the conversation, otherwise ignore it: {documents['summary']}"
    # TODO: Incorporate name and bio
    # system_message = f"About {name}: {bio}\n\n{system_message}"

    logger.debug(f"Augmenting by appending to system message: {system_message}")

    if chat_mode:
        system_msgs = [m for m in request.messages if m.role == "system"]
        if system_msgs:
            system_msgs[0].content += f"\n\n{system_message}"
        else:
            # request.messages.insert(0, Message(role="system", content=system_message))
            last_message = next((message for message in reversed(request.messages)), None)
            if last_message:
                last_message.content += f"\n\n[System note: {system_message}]"
            else:
                # This case should not happen, but just in case... with the caveat that some models do not support system messages.
                request.messages.insert(0, Message(role="system", content=system_message))
    else:
        request.prompt = system_message
