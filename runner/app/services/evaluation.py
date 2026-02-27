from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from functools import lru_cache
from statistics import mean
from typing import Any, Callable, Literal, Sequence

import httpx
from openai import OpenAI
from langchain.retrievers import ContextualCompressionRetriever, EnsembleRetriever
from langchain.retrievers.document_compressors import EmbeddingsFilter
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from app.config import get_settings
from app.services.rag import (
    chunk_documents,
    create_vector_store,
    ingest_playwright_docs,
    load_documents,
)

Mode = Literal["baseline", "advanced"]
METRIC_PRECISION = "llm_context_precision_with_reference"
METRIC_RECALL = "context_recall"
METRIC_FAITHFULNESS = "faithfulness"
SYNTHETIC_TESTSET_TIMEOUT_SECONDS = 300


@dataclass(frozen=True)
class RetrieverHit:
    chunk_id: str
    source: str
    text: str
    score: float


@dataclass(frozen=True)
class EvalSampleRow:
    sample_id: str
    query: str
    expected_source: str
    retrieved_sources: list[str]


@dataclass(frozen=True)
class EvalScore:
    faithfulness: float
    context_precision: float
    context_recall: float


def _is_daily_limit_error(error: Exception | str) -> bool:
    message = str(error).lower()
    return (
        "rate_limit_exceeded" in message
        and "requests per day" in message
        and "rpd" in message
    )


def _raise_if_daily_limit(error: Exception | str) -> None:
    if _is_daily_limit_error(error):
        raise RuntimeError(
            "OpenAI daily request limit reached (RPD). Stop evaluation and retry after quota reset."
        )


def _is_incomplete_generation_error(error: Exception | str) -> bool:
    message = str(error).lower()
    return "llm generation was not completed" in message or "increase the max_tokens" in message


def _assert_openai_rpd_available() -> None:
    settings = get_settings()
    if not settings.openai_api_key:
        return

    client = OpenAI(api_key=settings.openai_api_key)
    try:
        client.responses.create(
            model=settings.openai_chat_model,
            input="healthcheck",
            max_output_tokens=16,
        )
    except Exception as exc:  # noqa: BLE001
        _raise_if_daily_limit(exc)
        raise


def _set_asyncio_policy_for_ragas() -> None:
    # RAGAS relies on nest_asyncio; uvloop cannot be patched by nest_asyncio.
    asyncio.set_event_loop_policy(asyncio.DefaultEventLoopPolicy())


def _require_ragas() -> dict[str, Any]:
    _set_asyncio_policy_for_ragas()
    try:
        from ragas import EvaluationDataset, RunConfig, SingleTurnSample, evaluate
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from ragas.llms import LangchainLLMWrapper
        from ragas.metrics import Faithfulness, LLMContextPrecisionWithReference, LLMContextRecall
        from ragas.testset import TestsetGenerator
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"RAGAS import failed: {exc!s}") from exc

    return {
        "EvaluationDataset": EvaluationDataset,
        "RunConfig": RunConfig,
        "SingleTurnSample": SingleTurnSample,
        "evaluate": evaluate,
        "LangchainEmbeddingsWrapper": LangchainEmbeddingsWrapper,
        "LangchainLLMWrapper": LangchainLLMWrapper,
        "Faithfulness": Faithfulness,
        "LLMContextPrecisionWithReference": LLMContextPrecisionWithReference,
        "LLMContextRecall": LLMContextRecall,
        "TestsetGenerator": TestsetGenerator,
    }


def _build_ragas_models() -> dict[str, Any]:
    ragas_mod = _require_ragas()
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("Missing required env var: OPENAI_API_KEY.")

    llm_for_generation = ChatOpenAI(
        model=settings.openai_chat_model,
        temperature=0,
        api_key=settings.openai_api_key,
        max_tokens=settings.openai_eval_max_tokens,
    )
    llm_for_evaluation = ChatOpenAI(
        model=settings.openai_chat_model,
        temperature=0,
        api_key=settings.openai_api_key,
        max_tokens=settings.openai_eval_max_tokens,
    )

    embedding_model = OpenAIEmbeddings(
        model=settings.openai_embed_model,
        api_key=settings.openai_api_key,
    )

    return {
        **ragas_mod,
        "generator_llm": ragas_mod["LangchainLLMWrapper"](llm_for_generation),
        "evaluator_llm": ragas_mod["LangchainLLMWrapper"](llm_for_evaluation),
        "generator_embeddings": ragas_mod["LangchainEmbeddingsWrapper"](embedding_model),
        "answer_llm": llm_for_generation,
    }


@lru_cache(maxsize=4)
def _generate_synthetic_testset(sample_size: int):
    ragas_mod = _build_ragas_models()
    docs = load_documents()
    if not docs:
        raise RuntimeError("No documents found for synthetic testset generation.")

    generator = ragas_mod["TestsetGenerator"](
        llm=ragas_mod["generator_llm"],
        embedding_model=ragas_mod["generator_embeddings"],
    )

    def _generate(size: int):
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                lambda: generator.generate_with_langchain_docs(docs, testset_size=size)
            )
            return future.result(timeout=SYNTHETIC_TESTSET_TIMEOUT_SECONDS)

    try:
        return _generate(sample_size)
    except FutureTimeoutError as exc:
        raise RuntimeError(
            f"Synthetic testset generation timed out after {SYNTHETIC_TESTSET_TIMEOUT_SECONDS} seconds."
        ) from exc
    except Exception as exc:  # noqa: BLE001
        _raise_if_daily_limit(exc)
        if _is_incomplete_generation_error(exc) and sample_size > 4:
            reduced_sample_size = max(4, sample_size // 2)
            try:
                return _generate(reduced_sample_size)
            except FutureTimeoutError as retry_timeout:
                raise RuntimeError(
                    f"Synthetic testset generation timed out after {SYNTHETIC_TESTSET_TIMEOUT_SECONDS} seconds."
                ) from retry_timeout
            except Exception as retry_exc:  # noqa: BLE001
                _raise_if_daily_limit(retry_exc)
                raise RuntimeError(
                    "Synthetic testset generation failed after retry with reduced sample size. "
                    "Increase OPENAI_EVAL_MAX_TOKENS or run with smaller sample_size."
                ) from retry_exc
        raise


def _extract_eval_field(sample: Any, field: str, default: Any = "") -> Any:
    if hasattr(sample, field):
        value = getattr(sample, field)
        return value if value is not None else default
    if isinstance(sample, dict):
        return sample.get(field, default)
    return default


def _document_to_hit(doc: Document, index: int) -> RetrieverHit:
    metadata = doc.metadata or {}
    return RetrieverHit(
        chunk_id=str(metadata.get("chunk_id", f"retrieved-{index}")),
        source=str(metadata.get("source", "unknown")),
        text=doc.page_content or "",
        score=float(metadata.get("rerank_score", 0.0)),
    )


@lru_cache(maxsize=1)
def _get_openai_embeddings_model() -> OpenAIEmbeddings:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("Missing required env var: OPENAI_API_KEY.")
    return OpenAIEmbeddings(
        model=settings.openai_embed_model,
        api_key=settings.openai_api_key,
    )


def _baseline_retrieve(query: str, top_k: int) -> list[RetrieverHit]:
    vector_store = create_vector_store(chunks=None, force=False)
    hits = vector_store.similarity_search_with_score(query=query, k=top_k)
    rows: list[RetrieverHit] = []
    for index, (doc, score) in enumerate(hits):
        hit = _document_to_hit(doc, index)
        rows.append(RetrieverHit(hit.chunk_id, hit.source, hit.text, float(score)))
    return rows


@lru_cache(maxsize=1)
def _get_bm25_retriever() -> BM25Retriever:
    documents = load_documents()
    chunks = chunk_documents(documents)
    retriever = BM25Retriever.from_documents(chunks)
    return retriever


def _cohere_rerank(query: str, candidates: list[RetrieverHit], top_k: int) -> list[RetrieverHit]:
    settings = get_settings()
    if not settings.cohere_api_key:
        return candidates[:top_k]

    documents = [candidate.text[:1500] for candidate in candidates]
    if not documents:
        return []

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                "https://api.cohere.com/v2/rerank",
                headers={
                    "Authorization": f"Bearer {settings.cohere_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.cohere_rerank_model,
                    "query": query,
                    "documents": documents,
                    "top_n": top_k,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:  # noqa: BLE001
        return candidates[:top_k]

    reranked: list[RetrieverHit] = []
    for item in payload.get("results", []):
        index = int(item.get("index", -1))
        if 0 <= index < len(candidates):
            candidate = candidates[index]
            reranked.append(
                RetrieverHit(
                    chunk_id=candidate.chunk_id,
                    source=candidate.source,
                    text=candidate.text,
                    score=float(item.get("relevance_score", 0.0)),
                )
            )
    return reranked[:top_k]


def _advanced_retrieve(query: str, top_k: int, fetch_k: int) -> list[RetrieverHit]:
    vector_store = create_vector_store(chunks=None, force=False)
    dense_retriever = vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": fetch_k},
    )
    bm25_retriever = _get_bm25_retriever()
    bm25_retriever.k = fetch_k
    ensemble = EnsembleRetriever(
        retrievers=[dense_retriever, bm25_retriever],
        weights=[0.6, 0.4],
    )

    compressor = EmbeddingsFilter(
        embeddings=_get_openai_embeddings_model(),
        k=fetch_k,
    )
    contextual = ContextualCompressionRetriever(
        base_retriever=ensemble,
        base_compressor=compressor,
    )

    compressed_docs = contextual.invoke(query)
    merged: list[RetrieverHit] = []
    seen: set[str] = set()

    for index, doc in enumerate(compressed_docs):
        hit = _document_to_hit(doc, index)
        dedupe_key = f"{hit.chunk_id}:{hit.source}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        merged.append(hit)

    if not merged:
        return []

    return _cohere_rerank(query=query, candidates=merged, top_k=top_k)


def _build_answer(question: str, contexts: list[str], answer_llm: ChatOpenAI) -> str:
    context_block = "\n\n".join(contexts[:5])[:6000]
    prompt = (
        "You are a QA assistant. Answer only using the provided Playwright contexts. "
        "If context is insufficient, say so clearly.\n\n"
        f"Question: {question}\n\n"
        f"Contexts:\n{context_block}"
    )
    try:
        response = answer_llm.invoke(prompt)
    except Exception as exc:  # noqa: BLE001
        _raise_if_daily_limit(exc)
        raise
    content = response.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(item) for item in content)
    return str(content)


def _extract_metric_from_result(eval_result: Any, metric_name: str) -> float:
    value = None

    if isinstance(eval_result, dict):
        value = eval_result.get(metric_name)

    if value is None:
        try:
            value = dict(eval_result).get(metric_name)
        except Exception:  # noqa: BLE001
            value = None

    if value is None and hasattr(eval_result, "to_pandas"):
        try:
            df = eval_result.to_pandas()
            if metric_name in df.columns:
                value = float(df[metric_name].mean())
        except Exception:  # noqa: BLE001
            value = None

    try:
        return float(value) if value is not None else 0.0
    except Exception:  # noqa: BLE001
        return 0.0


def _evaluate_with_ragas(ragas_mod: dict[str, Any], samples: list[Any]) -> EvalScore:
    evaluation_dataset = ragas_mod["EvaluationDataset"](samples=samples)
    run_config = ragas_mod["RunConfig"](timeout=360)

    try:
        eval_result = ragas_mod["evaluate"](
            dataset=evaluation_dataset,
            metrics=[
                ragas_mod["LLMContextPrecisionWithReference"](),
                ragas_mod["LLMContextRecall"](),
                ragas_mod["Faithfulness"](),
            ],
            llm=ragas_mod["evaluator_llm"],
            embeddings=ragas_mod["generator_embeddings"],
            run_config=run_config,
        )
    except Exception as exc:  # noqa: BLE001
        _raise_if_daily_limit(exc)
        raise

    return EvalScore(
        faithfulness=round(_extract_metric_from_result(eval_result, METRIC_FAITHFULNESS), 4),
        context_precision=round(_extract_metric_from_result(eval_result, METRIC_PRECISION), 4),
        context_recall=round(_extract_metric_from_result(eval_result, METRIC_RECALL), 4),
    )


def _map_progress(
    on_progress: Callable[[int], None] | None,
    start: int,
    end: int,
) -> Callable[[int], None] | None:
    if on_progress is None:
        return None

    safe_start = max(0, min(start, 100))
    safe_end = max(safe_start, min(end, 100))
    span = safe_end - safe_start

    def _mapped(local_progress: int) -> None:
        clipped = max(0, min(local_progress, 100))
        on_progress(safe_start + int((clipped / 100) * span))

    return _mapped


def _retrieve_for_mode(mode: Mode, question: str, top_k: int, fetch_k: int) -> list[RetrieverHit]:
    if mode == "baseline":
        return _baseline_retrieve(question, top_k)
    return _advanced_retrieve(question, top_k=top_k, fetch_k=fetch_k)


def _build_eval_samples(
    ragas_mod: dict[str, Any],
    rows: list[Any],
    mode: Mode,
    top_k: int,
    fetch_k: int,
    on_progress: Callable[[int], None] | None = None,
) -> tuple[list[Any], list[EvalSampleRow]]:
    samples: list[Any] = []
    sample_rows: list[EvalSampleRow] = []

    for index, row in enumerate(rows):
        if on_progress and rows:
            on_progress(int(((index + 1) / len(rows)) * 100))

        eval_sample = getattr(row, "eval_sample", row)
        question = str(_extract_eval_field(eval_sample, "user_input", "")).strip()
        reference = str(_extract_eval_field(eval_sample, "reference", "")).strip()
        if not question:
            continue

        hits = _retrieve_for_mode(mode, question, top_k=top_k, fetch_k=fetch_k)
        contexts = [hit.text for hit in hits if hit.text.strip()]
        if not contexts:
            continue

        answer = _build_answer(question, contexts, ragas_mod["answer_llm"])
        single_turn = ragas_mod["SingleTurnSample"](
            user_input=question,
            response=answer,
            reference=reference,
            retrieved_contexts=contexts,
        )
        samples.append(single_turn)
        sample_rows.append(
            EvalSampleRow(
                sample_id=f"sample-{len(samples):03d}",
                query=question,
                expected_source="ragas_reference",
                retrieved_sources=[hit.source for hit in hits],
            )
        )

    return samples, sample_rows


def _format_mode_result(score: EvalScore, sample_rows: list[EvalSampleRow]) -> dict[str, Any]:
    return {
        "metrics": {
            "faithfulness": score.faithfulness,
            "context_precision": score.context_precision,
            "context_recall": score.context_recall,
        },
        "samples": [
            {
                "sample_id": row.sample_id,
                "query": row.query,
                "expected_source": row.expected_source,
                "retrieved_sources": row.retrieved_sources,
                "precision": score.context_precision,
                "recall": score.context_recall,
                "faithfulness": score.faithfulness,
            }
            for row in sample_rows
        ],
    }


def _evaluate_mode(
    sample_size: int,
    top_k: int,
    fetch_k: int,
    mode: Mode,
    on_progress: Callable[[int], None] | None = None,
    on_phase: Callable[[str], None] | None = None,
    phase_prefix: str | None = None,
) -> dict[str, Any]:
    def emit_phase(phase: str) -> None:
        if on_phase is None:
            return
        if phase_prefix:
            on_phase(f"{phase_prefix}_{phase}")
            return
        on_phase(phase)

    emit_phase("initializing")
    _assert_openai_rpd_available()
    if on_progress:
        on_progress(5)
    ragas_mod = _build_ragas_models()
    if on_progress:
        on_progress(15)
    emit_phase("dataset_generation")
    golden_dataset = _generate_synthetic_testset(sample_size)
    if on_progress:
        on_progress(25)
    rows = list(golden_dataset)
    if not rows:
        raise RuntimeError("Synthetic dataset generation returned no rows.")

    emit_phase("retrieval")
    samples, sample_rows = _build_eval_samples(
        ragas_mod=ragas_mod,
        rows=rows,
        mode=mode,
        top_k=top_k,
        fetch_k=fetch_k,
        on_progress=_map_progress(on_progress, 25, 80),
    )
    if not samples:
        raise RuntimeError("No valid evaluation samples were produced.")

    if on_progress:
        on_progress(85)
    emit_phase("scoring")
    score = _evaluate_with_ragas(ragas_mod=ragas_mod, samples=samples)
    if on_progress:
        on_progress(98)
    emit_phase("completed")
    return _format_mode_result(score=score, sample_rows=sample_rows)


def run_baseline_eval(
    sample_size: int,
    top_k: int,
    fetch_k: int,
    force_ingest: bool = False,
    on_progress: Callable[[int], None] | None = None,
    on_phase: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    ingest_playwright_docs(force=force_ingest)
    result = _evaluate_mode(
        sample_size,
        top_k,
        fetch_k,
        mode="baseline",
        on_progress=on_progress,
        on_phase=on_phase,
    )
    result["config"] = {"sample_size": sample_size, "top_k": top_k, "fetch_k": fetch_k, "mode": "baseline"}
    result["conclusion"] = "Baseline dense retriever scored the initial RAGAS benchmark on the generated test set."
    return result


def run_advanced_eval(
    sample_size: int,
    top_k: int,
    fetch_k: int,
    force_ingest: bool = False,
    on_progress: Callable[[int], None] | None = None,
    on_phase: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    ingest_playwright_docs(force=force_ingest)
    result = _evaluate_mode(
        sample_size,
        top_k,
        fetch_k,
        mode="advanced",
        on_progress=on_progress,
        on_phase=on_phase,
    )
    result["config"] = {"sample_size": sample_size, "top_k": top_k, "fetch_k": fetch_k, "mode": "advanced"}
    result["conclusion"] = "Advanced retriever uses contextual compression with Cohere reranking before RAGAS scoring."
    return result


def run_compare_eval(
    sample_size: int,
    top_k: int,
    fetch_k: int,
    force_ingest: bool = False,
    on_progress: Callable[[int], None] | None = None,
    on_phase: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if on_phase:
        on_phase("baseline_initializing")
    baseline = run_baseline_eval(
        sample_size,
        top_k,
        fetch_k,
        force_ingest=force_ingest,
        on_progress=_map_progress(on_progress, 5, 49),
        on_phase=on_phase,
    )
    if on_phase:
        on_phase("advanced_initializing")
    advanced = run_advanced_eval(
        sample_size,
        top_k,
        fetch_k,
        force_ingest=False,
        on_progress=_map_progress(on_progress, 50, 95),
        on_phase=on_phase,
    )

    deltas = {
        "faithfulness": round(advanced["metrics"]["faithfulness"] - baseline["metrics"]["faithfulness"], 4),
        "context_precision": round(
            advanced["metrics"]["context_precision"] - baseline["metrics"]["context_precision"],
            4,
        ),
        "context_recall": round(advanced["metrics"]["context_recall"] - baseline["metrics"]["context_recall"], 4),
    }

    avg_delta = mean(deltas.values())
    if avg_delta > 0:
        conclusion = "Advanced retriever improved average RAGAS score over baseline on this run."
    elif avg_delta < 0:
        conclusion = "Advanced retriever underperformed baseline on this run; tune retrieval strategy and rerank weights."
    else:
        conclusion = "Baseline and advanced retrievers performed equally on this run."

    if on_phase:
        on_phase("completed")

    return {
        "baseline": baseline,
        "advanced": advanced,
        "delta": deltas,
        "conclusion": conclusion,
        "config": {"sample_size": sample_size, "top_k": top_k, "fetch_k": fetch_k, "mode": "compare"},
    }
