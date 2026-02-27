from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_qdrant import QdrantVectorStore
from langchain_text_splitters import MarkdownTextSplitter
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.config import get_settings


def _build_chunk_id(document: Document, index: int) -> str:
    source = document.metadata.get("source", "unknown")
    text = (document.page_content or "").strip()
    return str(uuid5(NAMESPACE_URL, f"{source}:{index}:{text[:120]}"))


def _get_qdrant_client() -> QdrantClient:
    settings = get_settings()
    if not settings.qdrant_url:
        raise RuntimeError("Missing required env var: QDRANT_URL.")
    return QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key)


def _get_embeddings() -> OpenAIEmbeddings:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("Missing required env var: OPENAI_API_KEY.")
    return OpenAIEmbeddings(
        model=settings.openai_embed_model,
        api_key=settings.openai_api_key,
    )


def load_documents() -> list[Document]:
    """Load markdown documents from Playwright docs directory."""
    settings = get_settings()
    docs_dir = settings.playwright_docs_dir
    if not docs_dir.exists():
        raise RuntimeError(f"Playwright docs directory does not exist: {docs_dir}")

    loader = DirectoryLoader(
        str(docs_dir),
        glob="**/*.md",
        loader_cls=TextLoader,
        show_progress=False,
    )
    documents = loader.load()
    return [
        document
        for document in documents
        if document.metadata.get("source")
        and Path(str(document.metadata["source"])).name.lower() != "readme.md"
    ]


def chunk_documents(documents: list[Document]) -> list[Document]:
    """Split markdown documents into retrieval-friendly chunks."""
    settings = get_settings()
    splitter = MarkdownTextSplitter(
        chunk_size=settings.rag_chunk_size,
        chunk_overlap=settings.rag_chunk_overlap,
    )
    chunks = splitter.split_documents(documents)
    for index, chunk in enumerate(chunks):
        chunk.metadata = dict(chunk.metadata or {})
        chunk.metadata["chunk_id"] = _build_chunk_id(chunk, index)
    return chunks


def create_vector_store(chunks: list[Document] | None = None, force: bool = False) -> QdrantVectorStore:
    """Create or connect to Qdrant vector store and optionally ingest chunks."""
    settings = get_settings()
    client = _get_qdrant_client()
    embeddings = _get_embeddings()
    collection = settings.qdrant_collection

    collection_exists = client.collection_exists(collection_name=collection)
    if force and collection_exists:
        client.delete_collection(collection_name=collection)
        collection_exists = False

    if not collection_exists:
        vector_dimension = len(embeddings.embed_query("dimension probe"))
        client.create_collection(
            collection_name=collection,
            vectors_config=qmodels.VectorParams(size=vector_dimension, distance=qmodels.Distance.COSINE),
        )

    vector_store = QdrantVectorStore(
        client=client,
        collection_name=collection,
        embedding=embeddings,
    )

    if chunks:
        ids = [str(chunk.metadata.get("chunk_id", _build_chunk_id(chunk, idx))) for idx, chunk in enumerate(chunks)]
        vector_store.add_documents(documents=chunks, ids=ids)

    return vector_store


def get_rag_retriever(vector_store: QdrantVectorStore, top_k: int | None = None):
    """Build retriever from vector store with configured defaults."""
    settings = get_settings()
    effective_k = top_k or settings.retriever_k
    return vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": effective_k},
    )


def ingest_playwright_docs(force: bool = False) -> dict[str, Any]:
    settings = get_settings()
    client = _get_qdrant_client()
    collection = settings.qdrant_collection

    if not force and client.collection_exists(collection_name=collection):
        existing_count = client.count(collection_name=collection, exact=True).count
        if existing_count > 0:
            return {
                "collection": collection,
                "ingested": False,
                "chunks_total": existing_count,
                "message": "Collection already populated. Skipping ingest.",
            }

    documents = load_documents()
    chunks = chunk_documents(documents)
    if not chunks:
        return {
            "collection": collection,
            "ingested": False,
            "chunks_total": 0,
            "message": "No markdown chunks were found.",
        }

    create_vector_store(chunks=chunks, force=force)
    total = client.count(collection_name=collection, exact=True).count
    return {
        "collection": collection,
        "ingested": True,
        "chunks_total": total,
        "message": f"Ingest complete. Upserted {len(chunks)} chunks.",
    }


def retrieve_context(query: str, top_k: int | None = None) -> dict[str, Any]:
    settings = get_settings()
    collection = settings.qdrant_collection
    effective_top_k = top_k or settings.retriever_k
    fetch_k = max(settings.rag_fetch_k, effective_top_k)

    vector_store = create_vector_store(chunks=None, force=False)
    scored_hits = vector_store.similarity_search_with_score(query=query, k=fetch_k)

    chunks = []
    for index, (document, score) in enumerate(scored_hits[:effective_top_k]):
        metadata = document.metadata or {}
        chunk_id = str(metadata.get("chunk_id", f"retrieved-{index}"))
        source = str(metadata.get("source") or metadata.get("file_path") or "unknown")
        text = document.page_content or str(metadata.get("text", ""))
        chunks.append(
            {
                "id": chunk_id,
                "score": float(score),
                "source": source,
                "title": metadata.get("title"),
                "text": text,
            }
        )

    return {
        "query": query,
        "collection": collection,
        "chunks": chunks,
    }
