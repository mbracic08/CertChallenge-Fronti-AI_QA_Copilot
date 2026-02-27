from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from app.models.schemas import CreateJobRequest, CreateJobResponse, JobKind, JobState, JobStatus
from app.workers.job_worker import cancel_job, create_job, get_job, list_jobs

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", response_model=CreateJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def post_job(request: CreateJobRequest) -> CreateJobResponse:
    job = await create_job(request)
    return CreateJobResponse(job_id=job.job_id, status=job.status)


@router.get("/{job_id}", response_model=JobState)
async def get_job_status(job_id: str) -> JobState:
    job = await get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "NOT_FOUND", "message": "Job not found", "details": {"job_id": job_id}}},
        )
    return job


@router.post("/{job_id}/cancel", response_model=JobState)
async def post_cancel_job(job_id: str) -> JobState:
    try:
        job = await cancel_job(job_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "INVALID_OPERATION", "message": str(exc)}},
        ) from exc

    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "NOT_FOUND", "message": "Job not found", "details": {"job_id": job_id}}},
        )
    return job


@router.get("", response_model=list[JobState])
async def get_jobs(
    kind: JobKind | None = Query(default=None),
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[JobState]:
    return await list_jobs(kind=kind, status=status_filter, limit=limit)
