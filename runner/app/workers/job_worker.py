from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from app.models.schemas import (
    CreateJobRequest,
    EvalPayload,
    JobError,
    JobState,
    RunTestsPayload,
    ScanPayload,
)
from app.services.evaluation import run_advanced_eval, run_baseline_eval, run_compare_eval
from app.services.page_scan import scan_pages
from app.services.test_runner import run_flow_spec_tests

jobs: dict[str, JobState] = {}
jobs_lock = asyncio.Lock()
EVAL_JOB_TIMEOUT_SECONDS = 900


def utcnow() -> datetime:
    return datetime.now(UTC)


def _to_json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [_to_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_to_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _to_json_safe(item) for key, item in value.items()}
    return str(value)


async def create_job(request: CreateJobRequest) -> JobState:
    job_id = str(uuid4())
    job = JobState(
        job_id=job_id,
        kind=request.kind,
        status="queued",
        progress=0,
        created_at=utcnow(),
    )
    async with jobs_lock:
        jobs[job_id] = job
    asyncio.create_task(_run_job(job_id, request))
    return job


async def cancel_job(job_id: str) -> JobState | None:
    async with jobs_lock:
        current = jobs.get(job_id)
        if current is None:
            return None

        if current.kind != "run_tests":
            raise ValueError("Only run_tests jobs can be canceled.")

        if current.status in {"completed", "failed", "timeout", "canceled"}:
            return current

        current.status = "canceled"
        current.phase = "canceled"
        current.finished_at = utcnow()
        current.error = JobError(
            code="CANCELED_BY_USER",
            message="Run tests canceled by user.",
            details=None,
        )
        return current


async def get_job(job_id: str) -> JobState | None:
    async with jobs_lock:
        return jobs.get(job_id)


async def list_jobs(
    kind: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[JobState]:
    async with jobs_lock:
        items = list(jobs.values())

    if kind:
        items = [job for job in items if job.kind == kind]
    if status:
        items = [job for job in items if job.status == status]

    items.sort(key=lambda job: job.created_at, reverse=True)
    return items[:limit]


async def _run_job(job_id: str, request: CreateJobRequest) -> None:
    async with jobs_lock:
        current = jobs[job_id]
        if current.status == "canceled":
            return
        current.status = "running"
        current.phase = "initializing"
        current.started_at = utcnow()
        current.progress = 5

    try:
        loop = asyncio.get_running_loop()

        def on_progress(progress: int) -> None:
            asyncio.run_coroutine_threadsafe(_set_progress(job_id, progress), loop)

        def on_phase(phase: str) -> None:
            asyncio.run_coroutine_threadsafe(_set_phase(job_id, phase), loop)

        if request.kind == "scan":
            try:
                payload = ScanPayload.model_validate(request.payload)
            except ValidationError as exc:
                await _fail_job(job_id, "INVALID_INPUT", "Invalid job payload.", {"errors": exc.errors()})
                return
            scan_result = await scan_pages(
                url=payload.url,
                max_pages=payload.max_pages,
                max_depth=payload.max_depth,
                on_progress=on_progress,
            )
            result_payload = {
                "scan": scan_result,
                "prompt": payload.prompt,
            }
        elif request.kind in {"eval_baseline", "eval_advanced", "eval_compare"}:
            try:
                payload = EvalPayload.model_validate(request.payload or {})
            except ValidationError as exc:
                await _fail_job(job_id, "INVALID_INPUT", "Invalid job payload.", {"errors": exc.errors()})
                return
            try:
                if request.kind == "eval_baseline":
                    result_payload = await asyncio.wait_for(
                        asyncio.to_thread(
                            run_baseline_eval,
                            payload.sample_size,
                            payload.top_k,
                            payload.fetch_k,
                            payload.force_ingest,
                            on_progress,
                            on_phase,
                        ),
                        timeout=EVAL_JOB_TIMEOUT_SECONDS,
                    )
                elif request.kind == "eval_advanced":
                    result_payload = await asyncio.wait_for(
                        asyncio.to_thread(
                            run_advanced_eval,
                            payload.sample_size,
                            payload.top_k,
                            payload.fetch_k,
                            payload.force_ingest,
                            on_progress,
                            on_phase,
                        ),
                        timeout=EVAL_JOB_TIMEOUT_SECONDS,
                    )
                else:
                    result_payload = await asyncio.wait_for(
                        asyncio.to_thread(
                            run_compare_eval,
                            payload.sample_size,
                            payload.top_k,
                            payload.fetch_k,
                            payload.force_ingest,
                            on_progress,
                            on_phase,
                        ),
                        timeout=EVAL_JOB_TIMEOUT_SECONDS,
                    )
            except asyncio.TimeoutError:
                await _timeout_job(
                    job_id,
                    "EVAL_TIMEOUT",
                    f"Evaluation exceeded {EVAL_JOB_TIMEOUT_SECONDS} seconds. "
                    "Lower sample_size/fetch_k or rerun baseline first.",
                )
                return
        elif request.kind == "run_tests":
            try:
                payload = RunTestsPayload.model_validate(request.payload)
            except ValidationError as exc:
                await _fail_job(job_id, "INVALID_INPUT", "Invalid job payload.", {"errors": exc.errors()})
                return
            result_payload = await run_flow_spec_tests(
                url=payload.url,
                tests=payload.tests,
                batch_size=payload.batch_size,
                on_progress=on_progress,
                should_stop=lambda: jobs.get(job_id) is not None and jobs[job_id].status == "canceled",
            )
        else:
            raise ValueError(f"Unsupported job kind: {request.kind}")

        async with jobs_lock:
            current = jobs[job_id]
            if current.status == "canceled":
                current.result = _to_json_safe(result_payload)
                if current.error is None:
                    current.error = JobError(
                        code="CANCELED_BY_USER",
                        message="Run tests canceled by user.",
                        details=None,
                    )
                return
            if isinstance(result_payload, dict) and bool(result_payload.get("canceled")):
                current.status = "canceled"
                current.phase = "canceled"
                current.finished_at = utcnow()
                current.result = _to_json_safe(result_payload)
                current.error = JobError(
                    code="CANCELED_BY_USER",
                    message="Run tests canceled by user.",
                    details=None,
                )
                return
            current.status = "completed"
            current.phase = "completed"
            current.progress = 100
            current.finished_at = utcnow()
            current.result = _to_json_safe(result_payload)
            current.error = None

    except Exception as exc:  # noqa: BLE001
        await _fail_job(job_id, "JOB_FAILED", str(exc), None)


async def _set_progress(job_id: str, progress: int) -> None:
    async with jobs_lock:
        current = jobs.get(job_id)
        if not current or current.status != "running":
            return
        current.progress = max(current.progress, min(progress, 99))


async def _set_phase(job_id: str, phase: str) -> None:
    async with jobs_lock:
        current = jobs.get(job_id)
        if not current or current.status != "running":
            return
        current.phase = phase


async def _fail_job(job_id: str, code: str, message: str, details: dict | None) -> None:
    async with jobs_lock:
        current = jobs[job_id]
        if current.status == "canceled":
            return
        current.status = "failed"
        current.phase = "failed"
        current.finished_at = utcnow()
        safe_details = _to_json_safe(details) if details is not None else None
        current.error = JobError(code=code, message=message, details=safe_details)


async def _timeout_job(job_id: str, code: str, message: str) -> None:
    async with jobs_lock:
        current = jobs[job_id]
        if current.status == "canceled":
            return
        current.status = "timeout"
        current.phase = "timeout"
        current.finished_at = utcnow()
        current.error = JobError(code=code, message=message, details=None)
