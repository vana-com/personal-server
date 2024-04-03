import json

from selfie.config import get_app_config
from selfie.embeddings.base_scorer import BaseScorer
from selfie.embeddings.document_types import EmbeddingDocumentModel

config = get_app_config()


class ImportanceScorer(BaseScorer):
    def __init__(self, score_weight, use_local_llm=True):
        super().__init__(score_weight)
        self.use_local_llm = use_local_llm

    def calculate_raw_score(self, document: EmbeddingDocumentModel):
        """
        Calculate the raw importance score for a document using OpenAI's API.
        """
        extract_importance_prompt = """
        On the scale of 1 to 10, where 1 is purely mundane (e.g., brushing teeth, making bed) and 10 is extremely 
        poignant (e.g., a break up, college acceptance), rate the likely poignancy of the following document.
        Document: {document}
        """.format(
            document=document.text
        )

        rate_document = {
            "name": "rate_document",
            "description": "This function rates document importance for the given part of the conversation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "importanceScore": {
                        "type": "number",
                        "description": "Importance score on the scale of 1 to 10, where 1 is purely mundane and 10 is extremely poignant",
                    },
                },
                "required": ["importanceScore"],
            },
        }

        try:
            if self.use_local_llm:
                from txtai.pipeline import LLM

                llm = LLM(
                    config.local_functionary_model,
                    verbose=config.verbose_logging,
                    n_gpu_layers=-1 if config.gpu else 0,
                    method="llama.cpp",
                    chat_format="functionary",
                    n_ctx=4096,
                ).generator.llm
                chat_completion = llm.create_chat_completion
            else:
                from litellm import completion

                chat_completion = completion

            tool_choice = {"type": "function", "function": {"name": "rate_document"}}

            rate_document_tool = {"type": "function", "function": rate_document}

            response = chat_completion(
                # model='gpt-3.5-turbo',
                messages=[{"role": "user", "content": extract_importance_prompt}],
                # functions=[rate_document],
                # function_call={
                #     'name': rate_document['name'],
                # },
                tools=[rate_document_tool],
                tool_choice=tool_choice,
            )

            json_data = json.loads(
                response["choices"][0]["message"]["function_call"]["arguments"]
            )
            # json_data = json.loads(openai_response.choices[0].message.function_call.arguments)
            return json_data["importanceScore"]
        except Exception as e:
            print("Error calculating importance score:", str(e))
            return 0

    def normalize_score(self, score):
        """
        Normalize the score to a range of [0, 1].
        Assumes the original score is in [1, 10].
        """
        return 0 if score == 0 else (score - 1) / 9
