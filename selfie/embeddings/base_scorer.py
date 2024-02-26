from abc import ABC, abstractmethod

from selfie.embeddings.document_types import EmbeddingDocumentModel


class BaseScorer(ABC):
    def __init__(self, score_weight):
        self.score_weight = score_weight

    @abstractmethod
    def calculate_raw_score(self, *args, **kwargs):
        """
        Calculate the raw score for a document. Implementation is scorer-specific.
        """
        pass

    def normalize_score(self, score):
        """
        Normalize the score to a range of [0, 1].
        Default implementation. Can be overridden by child classes for specific normalization.
        """
        return max(0, min(1, score))  # Default normalization logic

    def calculate_score(self, document: EmbeddingDocumentModel, *args, **kwargs):
        """
        Wrapper method to calculate and then normalize the score.
        """
        return self.normalize_score(self.calculate_raw_score(document, *args, **kwargs))
