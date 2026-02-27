from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from app.models.schemas import (
    IngestDocsResponse,
    RetrieveRequest,
    RetrieveResponse,
)
from app.services.rag import ingest_playwright_docs, retrieve_context

router = APIRouter(prefix="/rag", tags=["rag"])


@router.post("/ingest", response_model=IngestDocsResponse)
async def ingest_docs(force: bool = Query(default=False)) -> IngestDocsResponse:
    try:
        result = ingest_playwright_docs(force=force)
        return IngestDocsResponse(**result)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "INGEST_FAILED", "message": str(exc)}},
        ) from exc


@router.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(request: RetrieveRequest) -> RetrieveResponse:
    try:
        result = retrieve_context(query=request.query, top_k=request.top_k)
        return RetrieveResponse(**result)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "RETRIEVE_FAILED", "message": str(exc)}},
        ) from exc
