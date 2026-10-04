"""Select the configured speech provider without changing the voice contracts."""

from collections.abc import AsyncIterator

from linkresume.modules.speech.aihubmix import AIHubMixSpeechGateway
from linkresume.modules.speech.aliyun import AliyunSpeechGateway
from linkresume.modules.speech.gateway import RecognitionEvent, SpeechGateway, SpeechProviderError, SpeechTarget


class ProviderSpeechGateway:
    def __init__(self, *, aliyun: SpeechGateway | None = None, aihubmix: SpeechGateway | None = None) -> None:
        self._providers = {"aliyun": aliyun or AliyunSpeechGateway(), "aihubmix": aihubmix or AIHubMixSpeechGateway()}

    def _provider(self, target: SpeechTarget) -> SpeechGateway:
        try:
            return self._providers[target.provider_code]
        except KeyError:
            raise SpeechProviderError() from None

    async def recognize(
        self, target: SpeechTarget, audio: AsyncIterator[bytes], *, hotwords: list[str], language: str,
    ) -> AsyncIterator[RecognitionEvent]:
        async for event in self._provider(target).recognize(target, audio, hotwords=hotwords, language=language):
            yield event

    async def synthesize(self, target: SpeechTarget, text: str, *, voice: str | None = None) -> bytes:
        return await self._provider(target).synthesize(target, text, voice=voice)
