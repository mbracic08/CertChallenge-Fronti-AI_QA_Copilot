from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.agent.flow_spec_agent import generate_flow_spec
from app.models.schemas import FlowSpecRequest, FlowSpecResponse

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/flow-spec", response_model=FlowSpecResponse)
async def post_flow_spec(request: FlowSpecRequest) -> FlowSpecResponse:
    try:
        return generate_flow_spec(
            url=request.url,
            prompt=request.prompt,
            scan=request.scan,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": {"code": "FLOW_SPEC_FAILED", "message": str(exc)}},
        ) from exc
