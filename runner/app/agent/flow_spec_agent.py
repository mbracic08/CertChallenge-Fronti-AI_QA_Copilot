from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any, Literal, TypedDict

import httpx
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from pydantic import ValidationError

from app.agent.prompts import FLOW_SPEC_SYSTEM_PROMPT
from app.config import get_settings
from app.models.schemas import FlowSpecResponse, FlowSpecTest
from app.services.rag import retrieve_context

MAX_AGENT_ITERATIONS = 4


class FlowSpecState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    url: str
    prompt: str | None
    scan: dict[str, Any]
    citations: list[str]
    tests: list[dict[str, Any]]
    error: str | None
    iteration_count: int


def _extract_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model output did not contain a valid JSON object.")
    return json.loads(text[start : end + 1])


def _fallback_tests(scan: dict[str, Any]) -> list[FlowSpecTest]:
    routes = scan.get("top_routes", []) or ["/"]
    top_route = routes[0] if routes else "/"
    return [
        FlowSpecTest(
            id="flow-001",
            title="Homepage renders core sections",
            tags=["critical", "navigation"],
            risk="high",
            duration_sec=20,
            steps=[
                "Open the homepage URL",
                "Verify primary heading is visible",
                "Verify main navigation links are visible",
            ],
            expected_result="Homepage and navigation render without errors.",
            why_suggested="Baseline smoke validation for every deployment.",
        ),
        FlowSpecTest(
            id="flow-002",
            title=f"Route accessibility check for {top_route}",
            tags=["routing"],
            risk="medium",
            duration_sec=18,
            steps=[
                f"Navigate to {top_route}",
                "Wait for page content to stabilize",
                "Check no runtime error banner is visible",
            ],
            expected_result="Route loads and remains interactive.",
            why_suggested="Ensures key scanned routes are reachable.",
        ),
    ]


@tool
def scan_site_context(url: str, scan_json: str) -> str:
    """Summarize known scan results for the target URL."""
    scan = json.loads(scan_json)
    summary = {
        "url": url,
        "pages_found": scan.get("pages_found", 0),
        "forms_detected": scan.get("forms_detected", 0),
        "auth_walls": scan.get("auth_walls", False),
        "top_routes": scan.get("top_routes", [])[:12],
    }
    return json.dumps(summary)


@tool
def search_playwright_docs(query: str, top_k: int = 5) -> str:
    """Retrieve relevant Playwright documentation chunks from Qdrant."""
    result = retrieve_context(query=query, top_k=top_k)
    compact_chunks = [
        {
            "source": chunk.get("source", "unknown"),
            "score": chunk.get("score", 0.0),
            "text": str(chunk.get("text", ""))[:1200],
        }
        for chunk in result.get("chunks", [])
    ]
    return json.dumps({"query": query, "chunks": compact_chunks})


@tool
def search_web_tavily(query: str, max_results: int = 3) -> str:
    """Fallback web search for edge cases when Playwright docs are not sufficient."""
    settings = get_settings()
    if not settings.tavily_api_key:
        return json.dumps(
            {
                "query": query,
                "results": [],
                "error": "TAVILY_API_KEY is not configured.",
            }
        )

    safe_max_results = max(1, min(max_results, 5))
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": settings.tavily_api_key,
                    "query": query,
                    "max_results": safe_max_results,
                    "search_depth": "basic",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:  # noqa: BLE001
        return json.dumps(
            {
                "query": query,
                "results": [],
                "error": f"Tavily request failed: {exc!s}",
            }
        )

    results = payload.get("results", [])
    compact_results = []
    for item in results:
        raw_score = item.get("score", 0.0)
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            score = 0.0
        compact_results.append(
            {
                "title": str(item.get("title", "")),
                "url": str(item.get("url", "")),
                "content": str(item.get("content", ""))[:1200],
                "score": score,
            }
        )
    return json.dumps({"query": query, "results": compact_results})


def get_tools():
    return [scan_site_context, search_playwright_docs, search_web_tavily]


def _build_agent_llm() -> ChatOpenAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("Missing required env var: OPENAI_API_KEY.")
    return ChatOpenAI(
        model=settings.openai_chat_model,
        temperature=0.2,
        api_key=settings.openai_api_key,
    )


def _should_continue(state: FlowSpecState) -> Literal["tools", "finalize"]:
    if state.get("iteration_count", 0) >= MAX_AGENT_ITERATIONS:
        return "finalize"

    messages = state.get("messages", [])
    if not messages:
        return "finalize"

    last_message = messages[-1]
    if isinstance(last_message, AIMessage) and last_message.tool_calls:
        return "tools"
    return "finalize"


def _extract_citations(messages: list[BaseMessage]) -> list[str]:
    citations: set[str] = set()
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        content = message.content if isinstance(message.content, str) else json.dumps(message.content)
        try:
            parsed = json.loads(content)
        except Exception:  # noqa: BLE001
            continue

        chunks = parsed.get("chunks")
        if not isinstance(chunks, list):
            continue

        for chunk in chunks:
            source = str((chunk or {}).get("source", "unknown"))
            citations.add(source)

        results = parsed.get("results")
        if isinstance(results, list):
            for item in results:
                url = str((item or {}).get("url", "")).strip()
                if url:
                    citations.add(url)
    return sorted(citations)


def _build_generation_input(url: str, prompt: str | None, scan: dict[str, Any]) -> str:
    payload = {
        "url": url,
        "prompt": prompt or "",
        "scan_summary": {
            "pages_found": scan.get("pages_found"),
            "forms_detected": scan.get("forms_detected"),
            "auth_walls": scan.get("auth_walls"),
            "top_routes": scan.get("top_routes", []),
        },
        "scan_json": json.dumps(scan),
        "instructions": (
            "First call scan_site_context with the provided url and scan_json. "
            "Then call search_playwright_docs. "
            "Call search_web_tavily only if docs context is insufficient. "
            "After tool usage, return valid JSON with key `tests` only."
        ),
    }
    return json.dumps(payload)


def agent_node(state: FlowSpecState) -> FlowSpecState:
    llm_with_tools = _build_agent_llm().bind_tools(get_tools())
    messages = [SystemMessage(content=FLOW_SPEC_SYSTEM_PROMPT)] + list(state.get("messages", []))
    response = llm_with_tools.invoke(messages)

    return {
        "messages": [response],
        "iteration_count": state.get("iteration_count", 0) + 1,
    }


def finalize_node(state: FlowSpecState) -> FlowSpecState:
    messages = list(state.get("messages", []))
    last_ai = next((msg for msg in reversed(messages) if isinstance(msg, AIMessage)), None)

    tests_raw: list[dict[str, Any]] = []
    if last_ai and isinstance(last_ai.content, str):
        try:
            parsed = _extract_json_object(last_ai.content)
            candidate = parsed.get("tests", [])
            if isinstance(candidate, list):
                tests_raw = candidate
        except Exception:  # noqa: BLE001
            tests_raw = []

    citations = _extract_citations(messages)

    return {
        "tests": tests_raw,
        "citations": citations,
    }


@lru_cache(maxsize=1)
def get_flow_spec_graph():
    workflow = StateGraph(FlowSpecState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", ToolNode(get_tools()))
    workflow.add_node("finalize", finalize_node)

    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges(
        "agent",
        _should_continue,
        {
            "tools": "tools",
            "finalize": "finalize",
        },
    )
    workflow.add_edge("tools", "agent")
    workflow.add_edge("finalize", END)

    return workflow.compile()


def generate_flow_spec(url: str, prompt: str | None, scan: dict[str, Any]) -> FlowSpecResponse:
    graph = get_flow_spec_graph()
    final_state = graph.invoke(
        {
            "url": url,
            "prompt": prompt,
            "scan": scan,
            "messages": [HumanMessage(content=_build_generation_input(url, prompt, scan))],
            "iteration_count": 0,
        }
    )

    citations = list(final_state.get("citations", []))
    tests_raw = final_state.get("tests", [])
    try:
        tests = [FlowSpecTest.model_validate(item) for item in tests_raw]
        if not tests:
            tests = _fallback_tests(scan)
    except (ValidationError, TypeError):
        tests = _fallback_tests(scan)

    return FlowSpecResponse(
        url=url,
        prompt=prompt,
        tests=tests,
        citations=citations,
    )
