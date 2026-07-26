from fastapi import Request

from linkcv.modules.llm.service import LLMService


def get_llm_service(request: Request) -> LLMService:
    return request.app.state.llm_service
