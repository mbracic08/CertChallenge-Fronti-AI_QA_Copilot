from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    qdrant_url: str | None
    qdrant_api_key: str | None
    qdrant_collection: str

    openai_api_key: str | None
    openai_embed_model: str
    openai_chat_model: str
    openai_eval_max_tokens: int
    cohere_api_key: str | None
    cohere_rerank_model: str
    tavily_api_key: str | None

    playwright_docs_dir: Path
    rag_chunk_size: int
    rag_chunk_overlap: int
    rag_fetch_k: int
    retriever_k: int


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    runner_root = Path(__file__).resolve().parents[1]
    default_docs_dir = runner_root / "data" / "playwright-docs"

    return Settings(
        qdrant_url=os.getenv("QDRANT_URL"),
        qdrant_api_key=os.getenv("QDRANT_API_KEY"),
        qdrant_collection=os.getenv("QDRANT_COLLECTION", "playwright_docs"),
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        openai_embed_model=os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small"),
        openai_chat_model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4.1-mini"),
        openai_eval_max_tokens=int(os.getenv("OPENAI_EVAL_MAX_TOKENS", "1200")),
        cohere_api_key=os.getenv("COHERE_API_KEY"),
        cohere_rerank_model=os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5"),
        tavily_api_key=os.getenv("TAVILY_API_KEY"),
        playwright_docs_dir=Path(os.getenv("PLAYWRIGHT_DOCS_DIR", str(default_docs_dir))),
        rag_chunk_size=int(os.getenv("RAG_CHUNK_SIZE", "1000")),
        rag_chunk_overlap=int(os.getenv("RAG_CHUNK_OVERLAP", "180")),
        rag_fetch_k=int(os.getenv("RAG_FETCH_K", "12")),
        retriever_k=int(os.getenv("RETRIEVER_K", "5")),
    )
