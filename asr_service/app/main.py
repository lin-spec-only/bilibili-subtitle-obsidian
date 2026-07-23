from __future__ import annotations

import re

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import Settings
from .jobs import JobManager
from .security import CLIENT_HEADER_VALUE

settings = Settings.from_env()
manager = JobManager(settings)
app = FastAPI(title="Bilibili Local ASR", version="0.4.0", docs_url=None, redoc_url=None)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, error: RequestValidationError) -> JSONResponse:
    errors = [
        {
            "location": ".".join(str(part) for part in item.get("loc", []) if part != "body"),
            "message": item.get("msg", "输入无效"),
        }
        for item in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": "请求参数无效", "errors": errors})


class CreateJobRequest(BaseModel):
    audio_urls: list[str] = Field(min_length=1, max_length=4)
    source_url: str = Field(min_length=1, max_length=4096)
    bvid: str = Field(min_length=3, max_length=32)
    cid: str = Field(min_length=1, max_length=32)
    part: int = Field(default=1, ge=1, le=10000)
    duration_seconds: float = Field(default=0, ge=0, le=24 * 60 * 60)
    language: str | None = Field(default=None, max_length=16)


def require_client(x_bilibili_asr_client: str = Header(default="")) -> None:
    if x_bilibili_asr_client != CLIENT_HEADER_VALUE:
        raise HTTPException(status_code=403, detail="不允许的本地客户端")


def _valid_job_id(job_id: str) -> str:
    if not re.fullmatch(r"[0-9a-f-]{36}", job_id):
        raise HTTPException(status_code=404, detail="任务不存在")
    return job_id


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "version": app.version,
        "model": settings.model_name,
        "device": settings.device,
        "compute_type": settings.compute_type,
    }


@app.post("/v1/jobs", dependencies=[Depends(require_client)])
def create_job(request: CreateJobRequest) -> dict:
    try:
        return manager.create(request.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(require_client)])
def get_job(job_id: str) -> dict:
    try:
        return manager.get(_valid_job_id(job_id))
    except KeyError as error:
        raise HTTPException(status_code=404, detail="任务不存在") from error


@app.delete("/v1/jobs/{job_id}", dependencies=[Depends(require_client)])
def cancel_job(job_id: str) -> dict:
    try:
        return manager.cancel(_valid_job_id(job_id))
    except KeyError as error:
        raise HTTPException(status_code=404, detail="任务不存在") from error
