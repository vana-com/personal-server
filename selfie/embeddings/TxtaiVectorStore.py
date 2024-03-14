"""txtai Vector store index.

An index that is built on top of an existing txtai vector store.
"""
import json
import logging
import os
import pickle
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

import fsspec
import numpy as np
from fsspec.implementations.local import LocalFileSystem
from llama_index.core.bridge.pydantic import PrivateAttr
from llama_index.core.schema import BaseNode, Node
from llama_index.core.vector_stores import VectorStoreQuery, VectorStoreQueryResult
from llama_index.core.vector_stores.types import (
    BasePydanticVectorStore,
    VectorStoreQueryMode,
    MetadataFilters, ExactMatchFilter,
)
from pydantic import BaseModel
from llama_index.core.vector_stores.simple import DEFAULT_VECTOR_STORE, NAMESPACE_SEP
from llama_index.core.vector_stores.types import (
    DEFAULT_PERSIST_DIR,
    DEFAULT_PERSIST_FNAME,
    BasePydanticVectorStore,
    VectorStoreQuery,
    VectorStoreQueryResult,
)
from txtai import Embeddings

logger = logging.getLogger(__name__)

IMPORT_ERROR_MSG = """
    `txtai` package not found. For instructions on
    how to install `txtai` please visit
    https://neuml.github.io/txtai/install/
"""

DEFAULT_PERSIST_PATH = os.path.join(
    DEFAULT_PERSIST_DIR, f"{DEFAULT_VECTOR_STORE}{NAMESPACE_SEP}{DEFAULT_PERSIST_FNAME}"
)


class TxtaiVectorStore(BasePydanticVectorStore):
    _embeddings = PrivateAttr()

    def __init__(
            self,
            txtai_index: Any,
            stores_text: bool = False,
            **kwargs: Any,
    ) -> None:
        """Initialize params."""
        try:
            import txtai
        except ImportError:
            raise ImportError(IMPORT_ERROR_MSG)

        self._embeddings = cast(txtai.embeddings.Embeddings, txtai_index)

        if self._embeddings.config.get("content"):
            stores_text = True

        super().__init__(stores_text=stores_text, **kwargs)

    def add(
            self,
            nodes: List[BaseNode],
            tags: Optional[str] = None,
            **add_kwargs: Any,
    ) -> List[str]:
        """Add nodes to index."""
        docs = []
        for node in nodes:
            print(node.metadata)
            if self.stores_text:
                doc = (node.node_id, {"text": node.get_text(), **node.metadata}, tags)
            else:
                doc = (node.node_id, node.get_embedding())
            docs.append(doc)

        print(docs)
        self._embeddings.index(docs)  # TODO: should this be upsert?
        print(self._embeddings.search("DOWN"))
        return [node.node_id for node in nodes]

    def delete(
            self,
            ref_doc_id: str,
            **delete_kwargs: Any
    ) -> None:
        """
        Delete nodes using with ref_doc_id.

        Args:
            ref_doc_id (str): The doc_id of the document to delete.

        """
        self._embeddings.delete([int(ref_doc_id)])

    @property
    def client(self) -> Any:
        """Return txtai client."""
        return self._embeddings

    @staticmethod
    def _build_query(query: VectorStoreQuery) -> str:
        """Build SQL query string from VectorStoreQuery."""
        query_str = "SELECT * FROM txtai"

        if query.filters is not None:
            filter_strs = []
            for filter in query.filters.filters:
                if isinstance(filter, ExactMatchFilter):
                    filter_strs.append(f"{filter.key} = '{filter.value}'")
                else:
                    filter_strs.append(f"{filter.key} {filter.operator.value} '{filter.value}'")

            if filter_strs:
                condition = query.filters.condition.value.lower()
                query_str += f" WHERE {f' {condition} '.join(filter_strs)}"

        if query.query_str is not None:
            if query.filters is not None:
                query_str += " AND "
            else:
                query_str += " WHERE "
            query_str += f"similar('{query.query_str}')"

        query_str += f" LIMIT {query.similarity_top_k}"
        return query_str

    def query(self, query: VectorStoreQuery, **kwargs: Any) -> VectorStoreQueryResult:
        """Query index for top k most similar nodes."""
        nodes = []
        similarities = []
        ids = []

        if query.mode == VectorStoreQueryMode.DEFAULT:
            if not self._embeddings.ann:
                raise ValueError("Dense index not enabled.")
            weights = None
        elif query.mode == VectorStoreQueryMode.SPARSE:
            if not self._embeddings.scoring:
                raise ValueError("Sparse index not enabled.")
            weights = 0
        else:  # VectorStoreQueryMode.HYBRID
            if query.alpha is None:
                raise ValueError("Alpha must be specified for hybrid search.")
            weights = query.alpha

        if query.query_str is not None:
            sql_query = self._build_query(query)
            logger.debug(f"SQL query: {sql_query}")
            results = self._embeddings.search(sql_query, weights=weights, limit=query.similarity_top_k)

            for result in results:
                if self.stores_text:
                    metadata = json.loads(result["data"])
                    node = Node(
                        id_=result["id"],
                        text=result["text"],
                        metadata=metadata,
                        tags=result.get("tags", []),
                        relationships={},
                    )
                else:
                    node = Node(id_=result["id"])
                nodes.append(node)
                similarities.append(result["score"])
                ids.append(result["id"])
        else:
            if not self._embeddings.ann:
                raise ValueError("Dense index not enabled for embedding-based queries.")

            query_embedding = cast(List[float], query.query_embedding)
            query_embedding_np = np.array(query_embedding, dtype="float32")[np.newaxis, :]

            # TODO:
            #     if query_embedding_np.shape[1] != self._embeddings.config["dimension"]:
            #         ~~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^
            # KeyError: 'dimension'
            #
            # if query_embedding_np.shape[1] != self._embeddings.config["dimension"]:
            #     raise ValueError(
            #         f"Query embedding dimension {query_embedding_np.shape[1]} does not match "
            #         f"the expected dimension {self._embeddings.config['dimension']}."
            #     )

            # TODO: IDs are coming back as -1 for documents created via self.add, even though _embeddings.search("DOWN") returns them
            results = self._embeddings.ann.search(query_embedding_np, query.similarity_top_k)[0]
            print(results)

            for result in results:
                doc_id = str(result[0])
                if self.stores_text:
                    print(f"SELECT * FROM txtai WHERE id = '{doc_id}' LIMIT 1")
                    metadata = self._embeddings.search(f"SELECT * FROM txtai WHERE id = '{doc_id}' LIMIT 1")[0]
                    node = Node(
                        id_=doc_id,
                        text=metadata["text"],
                        metadata=json.loads(metadata["data"]),
                        tags=metadata.get("tags", []),
                        relationships={},
                    )
                else:
                    node = Node(id_=doc_id)
                nodes.append(node)
                similarities.append(result[1])
                ids.append(doc_id)

        return VectorStoreQueryResult(nodes=nodes, similarities=similarities, ids=ids)

    def persist(
            self,
            persist_path: str = DEFAULT_PERSIST_PATH,
            fs: Optional[fsspec.AbstractFileSystem] = None,
            **kwargs: Any,
    ) -> None:
        """Save to file.

        This method saves the vector store to disk.

        Args:
            persist_path (str): The save_path of the file.
            fs (fsspec.AbstractFileSystem): The filesystem to use.

        """
        if fs and not isinstance(fs, LocalFileSystem):
            raise NotImplementedError("txtai only supports local storage for now.")

        dirpath = Path(persist_path).parent
        dirpath.mkdir(exist_ok=True)

        jsonconfig = self._embeddings.config.get("format", "pickle") == "json"
        # Determine if config is json or pickle
        config_path = dirpath / "config.json" if jsonconfig else dirpath / "config"

        # Write configuration
        with open(
                config_path,
                "w" if jsonconfig else "wb",
                encoding="utf-8" if jsonconfig else None,
        ) as f:
            if jsonconfig:
                # Write config as JSON
                json.dump(self._embeddings.config, f, default=str)
            else:
                from txtai.version import __pickle__

                # Write config as pickle format
                pickle.dump(self._embeddings.config, f, protocol=__pickle__)

        self._embeddings.save(persist_path, **kwargs)

    @classmethod
    def from_persist_path(cls, persist_path: str, **kwargs: Any) -> "TxtaiVectorStore":
        """Load the vector store from disk."""
        try:
            import txtai
        except ImportError:
            raise ImportError(IMPORT_ERROR_MSG)

        if not os.path.exists(persist_path):
            raise ValueError(f"Persisted index not found at {persist_path}")

        embeddings = txtai.embeddings.Embeddings(path=persist_path)
        return cls(txtai_index=embeddings, **kwargs)

    @classmethod
    def from_persist_path(
            cls,
            persist_path: str,
            fs: Optional[fsspec.AbstractFileSystem] = None,
    ) -> "TxtaiVectorStore":
        try:
            import txtai
        except ImportError:
            raise ImportError(IMPORT_ERROR_MSG)

        if fs and not isinstance(fs, LocalFileSystem):
            raise NotImplementedError("txtai only supports local storage for now.")

        if not os.path.exists(persist_path):
            raise ValueError(f"No existing {__name__} found at {persist_path}.")

        logger.info(f"Loading {__name__} config from {persist_path}.")
        parent_directory = Path(persist_path).parent
        config_path = parent_directory / "config.json"
        jsonconfig = config_path.exists()
        # Determine if config is json or pickle
        config_path = config_path if jsonconfig else parent_directory / "config"
        # Load configuration
        with open(config_path, "r" if jsonconfig else "rb") as f:
            config = json.load(f) if jsonconfig else pickle.load(f)

        logger.info(f"Loading {__name__} from {persist_path}.")

        txtai_index = Embeddings(config=config)
        txtai_index.load(persist_path)

        return cls(txtai_index=txtai_index)
