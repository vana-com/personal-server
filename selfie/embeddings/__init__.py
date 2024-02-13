import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import os
import shutil
from typing import Optional, List, Dict, Any, Coroutine, Callable

import humanize

from selfie.config import get_app_config
from selfie.data_generators.chat_training_data import (
    ChatTrainingDataGenerator,
)
from selfie.types.share_gpt import ShareGPTMessage
from selfie.embeddings.document_types import Document, ScoredDocument
from selfie.embeddings.importance_scorer import ImportanceScorer
from selfie.embeddings.recency_scorer import RecencyScorer
from selfie.embeddings.relevance_scorer import RelevanceScorer
from txtai.embeddings import Embeddings
import logging

from txtai.pipeline import LLM

logger = logging.getLogger(__name__)

default_importance = 0.3

config = get_app_config()

llm = LLM(
    verbose=config.verbose,
    path=config.local_model,
    method="llama.cpp",
    n_ctx=8192,
    n_gpu_layers=-1 if config.gpu else 0,
)


class DataIndex:
    _singleton = None

    def __new__(cls, *args, **kwargs):
        if not cls._singleton:
            cls._singleton = super(DataIndex, cls).__new__(cls)
        return cls._singleton

    def __init__(self, character_name, storage_path: str = config.embeddings_storage_root, use_local_llm=True, completion=None):
        if not hasattr(self, 'is_initialized'):
            logger.info("Initializing DataIndex")
            self.storage_path = os.path.join(storage_path, "index")
            os.makedirs(storage_path, exist_ok=True)

            async def completion_async(prompt):
                return llm(prompt)

            self.completion = completion or completion_async

            self.character_name = character_name
            self.embeddings = Embeddings(
                path="sentence-transformers/all-MiniLM-L6-v2",
                sqlite={"wal": True},
                # For now, sqlite w/the default driver is the only way to use WAL.
                content=True
                # TODO: may not work on Windows
                # https://docs.sqlalchemy.org/en/20/core/engines.html#sqlite
                # content=f"sqlite:///{os.path.join(storage_path, default_db_name)}"
            )
            self.token_used = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            }
            self.gpt3_call_count = 0
            self.importance_scorer = ImportanceScorer(
                score_weight=1, use_local_llm=use_local_llm
            )
            self.recency_scorer = RecencyScorer(score_weight=1)
            self.relevance_scorer = RelevanceScorer(score_weight=1)

            if os.path.exists(os.path.join(self.storage_path, "embeddings")):
                self.embeddings.load(self.storage_path)
            else:
                logger.info("Embeddings file not found, starting with a new embeddings index.")
                # self.embeddings.index(documents=[])
                # self.embeddings.save(self.storage_path)

            # Create a queue for database write operations
            self.db_write_queue = asyncio.Queue()
            # Start the background task to process database write operations
            asyncio.create_task(self.process_db_write_queue())
            self.executor = ThreadPoolExecutor()

            self.is_initialized = True

    async def close(self):
        self.executor.shutdown(wait=True)

    def has_data(self):
        return os.path.exists(f"{self.storage_path}/embeddings")

    async def process_db_write_queue(self):
        while True:
            task, future = await self.db_write_queue.get()  # Expecting a tuple of (task, future)
            try:
                if asyncio.iscoroutinefunction(task) or isinstance(task, Coroutine):
                    # TODO: one of these is correct, figure it out
                    # result = await task()  # Await coroutine and capture result
                    result = await task  # Await coroutine and capture result
                else:
                    loop = asyncio.get_event_loop()
                    result = await loop.run_in_executor(None, task)  # Execute sync function in executor and capture result
                future.set_result(result)  # Set the result on the future
            except Exception as e:
                future.set_exception(e)  # Set the exception on the future if something goes wrong
            finally:
                self.db_write_queue.task_done()

    async def enqueue_task(self, task: Callable[..., Any], *args, **kwargs) -> Any:
        """Enqueue a task that can be either synchronous or asynchronous."""
        future = asyncio.Future()
        if asyncio.iscoroutinefunction(task) or isinstance(task, Coroutine):
            # Prepare coroutine for execution; args, kwargs are applied
            wrapped_task = asyncio.ensure_future(task(*args, **kwargs))
        else:
            # Wrap synchronous function and its arguments in a lambda for deferred execution
            wrapped_task = lambda: task(*args, **kwargs)
        await self.db_write_queue.put((wrapped_task, future))
        return await future

    async def enqueue_upsert(self, documents: List[Dict[str, Any]] | List[tuple[int, Dict[str, Any]]]):
        """Enqueue an upsert operation."""
        return await self.enqueue_task(
            lambda: (result := self.embeddings.upsert(documents), self.embeddings.save(self.storage_path), result)[2]
        )

    async def enqueue_index(self, documents: List[Dict[str, Any]] | List[tuple[int, Dict[str, Any]]]):
        """Enqueue an index operation."""
        return await self.enqueue_task(
            lambda: (result := self.embeddings.index(documents), self.embeddings.save(self.storage_path), result)[2]
        )

    async def enqueue_delete(self, ids: List[int]):
        """Enqueue a delete operation."""
        return await self.enqueue_task(
            lambda: (result := self.embeddings.delete(ids), self.embeddings.save(self.storage_path), result)[2]
        )

    @staticmethod
    def map_share_gpt_data(
        conversation: List[ShareGPTMessage], source: str = "Unknown", source_document_id: int = None
    ) -> List[Document]:
        chunks = ChatTrainingDataGenerator.group_messages_into_chunks(
            conversation, overlap=1, max_messages=8, max_characters=0
        )
        documents = []
        for i, conv in enumerate(chunks):
            if any("REDACTED" in msg.value for msg in conv):
                continue
            last_user = ""
            formatted_conversation = "\n".join(
                f"\n{(last_user := msg.from_user)}:\n{msg.value}"
                if msg.from_user != last_user
                else f"{msg.value}"
                for msg in conv
            ).strip()

            document = Document(
                text=formatted_conversation,
                timestamp=conv[0].timestamp,
                source=source,
            )

            if source_document_id:
                document.source_document_id = source_document_id

            documents.append(document)
        return documents

    @staticmethod
    def _calculate_retrieval_score(
        recency_score,
        relevance_score,
        importance_score=None,
        importance_weight=1,
        recency_weight=1,
        relevance_weight=1,
    ):
        if importance_score is None:
            importance_score = default_importance
        return (
            (importance_score * importance_weight)
            + (recency_score * recency_weight)
            + (relevance_score * relevance_weight)
        ) / (importance_weight + recency_weight + relevance_weight)

    async def _summarize_documents(
        self, character_name: str, documents: List[Document], context, model
    ):
        logger.info(f"Summarizing {len(documents)} documents")

        if model is None:
            model = "gpt-3.5-turbo"
        if len(documents) == 0:
            return None
        document_summary = "\n\n".join(
            [
                f"{humanize.naturaltime(datetime.now(timezone.utc) - document.timestamp)}\n{document.text}"
                for document in documents
            ]
        )

        if character_name:
            prompt = f'### Instruction:\nYou are {character_name}. Below are conversation fragments from your recent memories. You are gathering your thoughts in preparation of writing a response for "{context}". In a sentence, concisely tell yourself what you can conclude about this topic from your memories, especially as it relates to you personally.\n\n### Input:\nStart of memories:\n{document_summary}\nEnd of memories.\n\n### Concise response:\n{character_name}:\nBased on the given conversation fragments, it can be concluded that '
        else:
            prompt = f'### Instruction:\nBelow are conversation fragments from an unknown person. You are gathering your thoughts in preparation of writing a response for "{context}". In a sentence, concisely answer what you can conclude about this topic from the memories.\n\n### Input:\nStart of memories:\n{document_summary}\nEnd of memories.\n\n### Concise response:\nYou:\nBased on the given conversation fragments, it can be concluded that '

        logger.debug(f"Model: {model}")
        logger.debug(f"Prompt: {prompt}")

        # TODO: truncate the prompt to fit the context window
        if model == "local":
            return await self.completion(prompt)
        else:
            from litellm import completion

            openai_response = completion(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            return openai_response.choices[0].message.content

    def map_document(self, document: Document, extract_importance=True):
        return {
            **document.to_dict(),
            **(
                {
                    "importance": document.importance
                    if document.importance is not None  # Only calculate importance if it's not already set
                    else self.importance_scorer.calculate_score(document)

                } if extract_importance else {}
            ),
        }

    def _query(
            self,
            where: str = None,
            parameters: Dict[str, Any] = None,
            limit: int = None,
            offset: int = None,
            order_by: str = None,
            group_by: str = None,
    ) -> List[Dict[str, Any]]:
        parameters = parameters or {}
        query_components = [
            f"SELECT score, {', '.join(Document.model_fields.keys())} FROM txtai"
        ]

        if where:
            query_components.append(f"WHERE {where}")

        if group_by:
            query_components.append(f"GROUP BY {group_by}")

        if order_by:
            query_components.append(f"ORDER BY {order_by}")

        if offset is not None:
            query_components.append("OFFSET :offset")
            parameters["offset"] = offset

        logger.debug(f"Query looks like {' '.join(query_components)}")
        return self.embeddings.search(" ".join(query_components), parameters=parameters, limit=limit)

    async def index(self, documents: List[Document], extract_importance=True, upsert=False):
        start_time = time.time()
        logger.info(f"Indexing {len(documents)} documents started at {start_time}")

        documents = [
            await self.find_existing_document(document) or document for document in documents
        ] if upsert else documents

        with_importance = [
            self.map_document(document, extract_importance) for document in documents
        ]

        logger.info("Starting upsert operation")
        # self.embeddings.upsert(with_importance)
        await self.enqueue_upsert(with_importance)
        logger.info("Upsert operation completed")

        self.embeddings.save(self.storage_path)

        return with_importance
        # TODO: return document with ID, if possible

    async def recall(
        self,
        topic: str,
        topic_context=None,
        character_name: Optional[str] = None,
        limit=5,
        importance_weight=0,
        recency_weight=1,
        relevance_weight=1,
        include_summary=True,
        local_llm=True,
        min_score=0.4,
    ):
        if min_score is None:
            min_score = 0.4

        if not self.has_data():
            return {"documents": [], "summary": "No documents found.", "mean_score": 0}
        self.embeddings.load(self.storage_path)

        results = self._query(where="similar(:topic)", parameters={"topic": topic}, limit=limit)
        documents_list: List[ScoredDocument] = []
        for result in results:
            document = Document(
                text=result["text"],
                timestamp=result["timestamp"],
                importance=result["importance"],
                source=result["source"],
                updated_timestamp=result["updated_timestamp"],
                source_document_id=result["source_document_id"],
            )
            relevance_score = self.relevance_scorer.calculate_score(
                document, result["score"]
            )
            recency_score = self.recency_scorer.calculate_score(document)
            importance_score = document.importance
            retrieval_score = self._calculate_retrieval_score(
                recency_score,
                relevance_score,
                importance_score,
                importance_weight,
                recency_weight,
                relevance_weight,
            )
            documents_list.append(
                ScoredDocument(
                    **document.model_dump(),
                    score=retrieval_score,
                    relevance=relevance_score,
                    recency=recency_score,
                )
            )

        documents_list = [m for m in documents_list if m.score > min_score]
        if len(documents_list) == 0:
            return {"documents": [], "summary": "No documents found.", "mean_score": 0}

        documents_list.sort(key=lambda x: x.score, reverse=True)
        short_documents_list = documents_list[:limit]
        summary = (
            await self._summarize_documents(
                character_name,
                short_documents_list,
                topic_context if topic_context else topic,
                ("local" if local_llm else None),
            )
            if include_summary
            else None
        )
        return {"documents": short_documents_list, "summary": summary, "mean_score": sum([m.score for m in short_documents_list]) / len(short_documents_list)}

    # TODO: Fix this
    def delete_all(self):
        logger.info("Deleting all documents")
        if self.has_data():
            shutil.rmtree(f"{self.storage_path}/embeddings")
            logger.info(f"Deleted storage path: {self.storage_path}")
        else:
            logger.info("Storage path not found, nothing to delete.")

    async def delete_documents(self, document_ids):
        await self.enqueue_delete(document_ids)
        deleted_ids = document_ids # TODO: this is a hack because enqueue_delete doesn't return anything
        # TODO: determine whether anything was actually deleted
        return deleted_ids

    async def delete_document(self, document_id):
        return await self.delete_documents([document_id])

    async def delete_documents_with_source_documents(self, source_document_ids):
        results = self._query(where=f"source_document_id IN ({', '.join([str(doc_id) for doc_id in source_document_ids])})", limit=999999)
        print(f"Trying to delete {len(results)} results for source documents: {source_document_ids}")
        results = await self.enqueue_delete([result['id'] for result in results])
        print(f"Deleted {len(results)} indexed documents")
        return results

    async def update_document(self, document_id, updated_document, extract_importance=True):
        await self.enqueue_upsert(
            [(document_id, self.map_document(updated_document, extract_importance))]
        )

    def get_document_count(self, source_document_ids: Optional[List[str]] = None):
        if not self.has_data():
            return 0

        if source_document_ids:
            return self.embeddings.search(f"SELECT count(*) FROM txtai WHERE source_document_id IN ({', '.join(source_document_ids)})")[0]["count(*)"]
        else:
            return self.embeddings.count()

    async def get_document(self, document_id):
        if not self.has_data():
            return None  # TODO: raise exception?
        result = self._query(where=f"id = :id", parameters={"id": document_id})
        return result[0] if result else None

    def get_documents_with_source_document(self, source_document_id):
        return self._query(where="source_document_id = :source_document_id", parameters={"source_document_id": source_document_id}) if self.has_data() else []

    def get_one_document_per_source_document(self, source_document_ids: Optional[List[str]] = None):
        if not self.has_data():
            return []

        if source_document_ids:
            # sources_placeholder = ', '.join(['?' for _ in sources])
            where_in_clause = f"source_document_id IN ({', '.join(source_document_ids)})"
        else:
            where_in_clause = ""

        # Bad queries
        # query = f"SELECT id, timestamp, text, importance, source, updated_timestamp, source_document_id FROM txtai WHERE source_document_id IS NOT NULL AND source_document_id IN ({', '.join(sources)}) AND id IN (SELECT id FROM txtai WHERE source_document_id IS NOT NULL GROUP BY source_document_id HAVING max(updated_timestamp))"
        # query = f"SELECT id, timestamp, text, importance, source, updated_timestamp, source_document_id FROM txtai WHERE source_document_id IS NOT NULL AND source_document_id IN ({', '.join(sources)}) GROUP BY source_document_id HAVING max(updated_timestamp) LIMIT 999999"
        # query = f"SELECT id, source_document_id FROM txtai {where_in_clause} GROUP BY source_document_id LIMIT 999999"
        # return self.embeddings.search(query)
        return self._query(where=where_in_clause, group_by="source_document_id", limit=999999)

    async def find_existing_document(self, document: Document):
        if not self.has_data():
            return None
        result = self._query(
            where="text = :text AND timestamp = :timestamp AND source = :source AND source_document_id = :source_document_id",
            parameters={
                "text": document.text,
                "timestamp": document.timestamp.isoformat(),
                "source": document.source,
                "source_document_id": document.source_document_id,
            },
        )

        if len(result) > 1:
            logger.warning(f"Found {len(result)} documents matching {document})")
        if len(result) > 0:
            logger.debug(f"Found an existing document matching")

            # TODO: This is kinda horrible
            result[0]['id'] = int(result[0]['id'])
            result[0]['source_document_id'] = int(result[0]['source_document_id'])

        return Document(**result[0]) if result else None

    async def get_documents(self, offset=0, limit=10):
        if not self.has_data():
            return []

        return self._query(limit=limit, offset=offset, order_by="timestamp DESC")
