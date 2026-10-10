from fastapi import Request

from drawoffer.modules.llm.service import LLMService
from drawoffer.modules.llm.pi_probe import PiProbeCoordinator


def get_llm_service(request: Request) -> LLMService:
    return request.app.state.llm_service


def get_pi_probe_coordinator(request: Request) -> PiProbeCoordinator:
    return request.app.state.pi_probe_coordinator
