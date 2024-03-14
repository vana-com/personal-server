"""txtai Vector store index.

An index that is built on top of an existing txtai vector store.
"""
import json
import logging
from typing import Any, List, cast

import numpy as np
from llama_index.core.bridge.pydantic import PrivateAttr

from llama_index.core.schema import BaseNode, Node
from llama_index.core.vector_stores import (
    VectorStoreQuery,
    VectorStoreQueryResult,
)
from llama_index.core.vector_stores.types import (
    BasePydanticVectorStore, VectorStoreQueryMode
)

logger = logging.getLogger()

IMPORT_ERROR_MSG = """
    `txtai` package not found. For instructions on
    how to install `txtai` please visit
    https://neuml.github.io/txtai/install/
"""


class TxtaiVectorStore(BasePydanticVectorStore):
    """txtai Vector Store.

    Embeddings and documents are stored within a txtai index.

    During query time, the index uses txtai to query for the top
    k most similar nodes.

    Args:
        txtai_embeddings (txtai.embeddings.Embeddings): A txtai embeddings instance
            with content storage enabled.

    """

    stores_text: bool = True

    _embeddings = PrivateAttr()

    def __init__(
            self,
            txtai_index: Any,
    ) -> None:
        """Initialize params."""
        try:
            import txtai
        except ImportError:
            raise ImportError(IMPORT_ERROR_MSG)

        if not txtai_index.config.get("content"):
            raise ValueError("The txtai embeddings instance must have content storage enabled.")

        self._embeddings = cast(txtai.embeddings.Embeddings, txtai_index)
        super().__init__()

    def add(
            self,
            nodes: List[BaseNode],
            **add_kwargs: Any,
    ) -> List[str]:
        """Add nodes to index.

        Args:
            nodes (List[BaseNode]): List of nodes to add to the index.

        """
        docs = []
        for node in nodes:
            doc = (node.ref_doc_id, {"text": node.get_text()}, node.extra_info)
            docs.append(doc)

        self._embeddings.index(docs)
        return [node.ref_doc_id for node in nodes]

    @property
    def client(self) -> Any:
        """Return txtai client."""
        return self._embeddings

    def query(self, query: VectorStoreQuery, **kwargs: Any) -> VectorStoreQueryResult:
        """Query index for top k most similar nodes.

        Args:
            query (VectorStoreQuery): Query parameters.

        """
        if query.filters is not None:
            # TODO: Implement metadata filters
            raise ValueError("Metadata filters not implemented for txtai yet.")

        similarity_top_k = cast(int, query.similarity_top_k)

        # print("query", query)

        if query.mode == VectorStoreQueryMode.DEFAULT:
            if not self._embeddings.ann:
                raise ValueError("Dense index not enabled.")

            weights = 1
        elif query.mode == VectorStoreQueryMode.SPARSE:
            if not self._embeddings.scoring:
                raise ValueError("Sparse index not enabled.")

            weights = 0
        else:
            if query.alpha is not None and query.alpha > 0 and not self._embeddings.ann:
                raise ValueError("Dense index not enabled.")
            if query.alpha is not None and query.alpha < 1 and not self._embeddings.scoring:
                raise ValueError("Sparse index not enabled.")

            weights = query.alpha if query.alpha is not None else 0.5  # hybrid

        if query.query_str is not None:
            print("query.query_str", query.query_str)
            # Natural language query
            natural_language_query = cast(str, query.query_str)
            sql = f"SELECT * FROM txtai WHERE similar(':{natural_language_query}, {weights})') LIMIT {similarity_top_k}"
            # results = self._query(where=f"similar(:topic, {hybrid_search_weight})", parameters={"topic": topic}, limit=limit)

            print(sql)
            results = self._embeddings.search(sql, weights=weights, limit=similarity_top_k) # TODO: Also use sparse_top_k
            print(results)

            # TODO: Figure out how to resolve the fact that query_embedding is provided, unused, and potentially different than the embedding txtai would generate
        else:
            print("query.query_embedding", query.query_embedding)
            # Embedding-based query
            query_embedding = cast(List[float], query.query_embedding)
            query_embedding_np = np.array(query_embedding, dtype="float32")[np.newaxis, :]
            results = self._embeddings.ann.search(query_embedding_np, similarity_top_k)

        nodes = []
        similarities = []
        ids = []
        metadatas = []

        if query.query_str is not None:
            print("STRING")
            # Result processing for natural language queries
            for result in results:
                print({
                    'id': result["id"],

                    **json.loads(result["data"])
                })
                # TODO: Where does tags fit here, vs metadata?
                node = Node(
                    text=result["text"],
                    extra_info={
                        'id': result["id"],
                        **{k: v for k, v in json.loads(result["data"]).items() if k != "text"}
                    }
                    # TODO: populate more keys, like relationships?
                )
                nodes.append(node)
                similarities.append(result["score"])
                ids.append(result["id"])
                metadatas.append(result)
        else:
            print("EMBEDDING")
            # Result processing for embedding-based queries
            for result in results[0]:
                doc_id = str(result[0])
                metadata = self._embeddings.search(f"SELECT * FROM txtai WHERE id = '{doc_id}' LIMIT 1")[0]
                node = Node(
                    text=metadata["text"],
                    extra_info={
                        'id': doc_id,
                        **{k: v for k, v in json.loads(metadata["data"]).items() if k != "text"}
                    }
                    # TODO: populate more keys, like relationships?
                )
                nodes.append(node)
                similarities.append(result[1])
                ids.append(doc_id)
                metadatas.append(metadata)

        return VectorStoreQueryResult(nodes=nodes, similarities=similarities, ids=ids)  # , metadatas=metadatas)

    def delete(self, ref_doc_id: str, **delete_kwargs: Any) -> None:
        """
        Delete nodes using with ref_doc_id.

        Args:
            ref_doc_id (str): The doc_id of the document to delete.

        """
        # self._txtai_index.delete([int(ref_doc_id)])
        self._embeddings.delete(where={"id": ref_doc_id}, **delete_kwargs)  # TODO: not sure which approach is better
