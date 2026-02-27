from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load runner/.env before importing modules that read env at import time.
load_dotenv()

from app.api.agent import router as agent_router
from app.api.jobs import router as jobs_router
from app.api.rag import router as rag_router

app = FastAPI(title="Fronti Runner", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(jobs_router)
app.include_router(rag_router)
app.include_router(agent_router)
