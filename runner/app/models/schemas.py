from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

JobKind = Literal[
    "scan",
    "run_tests",
    "eval_baseline",
    "eval_advanced",
    "eval_compare",
    "report_pdf",
]
JobStatus = Literal["queued", "running", "completed", "failed", "timeout", "canceled"]


class ScanPayload(BaseModel):
    url: str = Field(..., min_length=1)
    prompt: str | None = None
    max_pages: int = Field(default=30, ge=1, le=120)
    max_depth: int = Field(default=2, ge=1, le=4)


class EvalPayload(BaseModel):
    sample_size: int = Field(default=12, ge=4, le=40)
    top_k: int = Field(default=5, ge=1, le=10)
    fetch_k: int = Field(default=20, ge=5, le=50)
    force_ingest: bool = False


class CreateJobRequest(BaseModel):
    kind: JobKind
    payload: dict[str, Any]


class CreateJobResponse(BaseModel):
    job_id: str
    status: JobStatus


class JobError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class JobState(BaseModel):
    job_id: str
    kind: JobKind
    status: JobStatus
    phase: str | None = None
    progress: int = Field(default=0, ge=0, le=100)
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    result: dict[str, Any] | None = None
    error: JobError | None = None


class IngestDocsResponse(BaseModel):
    collection: str
    ingested: bool
    chunks_total: int
    message: str


class RetrieveRequest(BaseModel):
    query: str = Field(..., min_length=2)
    top_k: int = Field(default=5, ge=1, le=10)


class RetrievedChunk(BaseModel):
    id: str
    score: float
    source: str
    title: str | None = None
    text: str


class RetrieveResponse(BaseModel):
    query: str
    collection: str
    chunks: list[RetrievedChunk]


class FlowSpecTest(BaseModel):
    id: str
    title: str
    tags: list[str]
    risk: Literal["low", "medium", "high"]
    duration_sec: int
    steps: list[str]
    expected_result: str
    why_suggested: str


class RunTestsPayload(BaseModel):
    url: str = Field(..., min_length=1)
    tests: list[FlowSpecTest] = Field(..., min_length=1)
    batch_size: int = Field(default=4, ge=1, le=8)


class FlowSpecRequest(BaseModel):
    url: str = Field(..., min_length=1)
    prompt: str | None = None
    scan: dict[str, Any]


class FlowSpecResponse(BaseModel):
    url: str
    prompt: str | None = None
    tests: list[FlowSpecTest]
    citations: list[str]
