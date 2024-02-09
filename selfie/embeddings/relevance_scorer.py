from selfie.embeddings.base_scorer import BaseScorer
from selfie.embeddings.document_types import Document


# TODO: rename this to IdentityScorer
# TODO: query weaviate for certainty instead of distance
# See https://weaviate.io/developers/weaviate/config-refs/distances#distance-vs-certainty
class RelevanceScorer(BaseScorer):
    def __init__(self, score_weight):
        super().__init__(score_weight)

    def calculate_raw_score(self, document: Document, certainty: float):
        # TODO use certainty?
        return certainty

    def normalize_score(self, score):
        return score
