from datetime import datetime
from dateutil import parser
import math

from selfie.embeddings.base_scorer import BaseScorer
from selfie.embeddings.document_types import Document

from datetime import timezone


class RecencyScorer(BaseScorer):
    def __init__(self, score_weight, current_time=datetime.now(timezone.utc)):
        super().__init__(score_weight)
        self.current_time = current_time

    def calculate_raw_score(
        self, document: Document, document_index: int = None, num_documents: int = None
    ):
        """
        Calculate recency score using an exponential decay function.
        """
        time_difference_seconds = (self.current_time - document.timestamp).total_seconds()

        a = 0
        b_years = 0.75
        seconds_per_year = 31536000
        # You can visualize this curve on https://www.desmos.com/calculator
        # Type in:
        #     exp(0 - 0.75 * x) for a = 0, b = 0.75
        # This will display the curve in years.
        by_date = math.exp(a - (b_years / seconds_per_year) * time_difference_seconds)

        if document_index is None or num_documents is None:
            return by_date

        by_position = 1 - ((num_documents - document_index) / num_documents)

        # TODO: Revisit this
        # Give equal weight to time and position
        return (by_date + by_position) / 2
