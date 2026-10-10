"""In-memory evidence retrieval over user-selected dataset materials.

Phase one builds no persistent index. A future vector index replaces
``MaterialRetriever`` while callers keep the same query/snippet contract.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

CHUNK_CHARS = 800
SNIPPET_CHARS = 300
_HEADING = re.compile(r"(?m)^#{1,6}\s")
_ASCII_WORD = re.compile(r"[a-z0-9][a-z0-9+#.\-]*")
_CJK = re.compile(r"[㐀-鿿]+")


@dataclass(frozen=True)
class MaterialDocument:
    dataset_id: str
    title: str
    version: str
    markdown: str


@dataclass(frozen=True)
class MaterialChunk:
    dataset_id: str
    title: str
    version: str
    position: int
    text: str


@dataclass(frozen=True)
class EvidenceSnippet:
    dataset_id: str
    title: str
    version: str
    position: int
    text: str
    score: float

    def as_dict(self) -> dict[str, object]:
        return {
            "dataset_id": self.dataset_id,
            "title": self.title,
            "version": self.version,
            "position": self.position,
            "text": self.text[:SNIPPET_CHARS],
        }


def tokenize(text: str) -> list[str]:
    lowered = text.casefold()
    tokens = _ASCII_WORD.findall(lowered)
    for run in _CJK.findall(lowered):
        if len(run) == 1:
            tokens.append(run)
        tokens.extend(run[index : index + 2] for index in range(len(run) - 1))
    return tokens


def split_chunks(document: MaterialDocument) -> list[MaterialChunk]:
    sections = [part.strip() for part in _HEADING.split(document.markdown) if part.strip()]
    chunks: list[MaterialChunk] = []
    for section in sections:
        for start in range(0, len(section), CHUNK_CHARS):
            text = section[start : start + CHUNK_CHARS].strip()
            if text:
                chunks.append(
                    MaterialChunk(
                        dataset_id=document.dataset_id,
                        title=document.title,
                        version=document.version,
                        position=len(chunks),
                        text=text,
                    )
                )
    return chunks


class MaterialRetriever:
    def __init__(self, documents: list[MaterialDocument]) -> None:
        self._chunks = [chunk for document in documents for chunk in split_chunks(document)]
        self._counts = [Counter(tokenize(chunk.text)) for chunk in self._chunks]
        document_frequency: Counter[str] = Counter()
        for counts in self._counts:
            document_frequency.update(counts.keys())
        total = len(self._chunks)
        self._idf = {
            token: math.log(1 + total / frequency)
            for token, frequency in document_frequency.items()
        }

    @property
    def empty(self) -> bool:
        return not self._chunks

    def leading(self, *, limit: int) -> list[EvidenceSnippet]:
        """First chunks of each document, used when queries match nothing."""
        firsts: list[MaterialChunk] = []
        seen: set[str] = set()
        for chunk in self._chunks:
            if chunk.dataset_id not in seen:
                seen.add(chunk.dataset_id)
                firsts.append(chunk)
        rest = [chunk for chunk in self._chunks if chunk not in firsts]
        return [
            EvidenceSnippet(
                dataset_id=chunk.dataset_id,
                title=chunk.title,
                version=chunk.version,
                position=chunk.position,
                text=chunk.text,
                score=0.0,
            )
            for chunk in (firsts + rest)[:limit]
        ]

    def search(self, query: str, *, limit: int = 3) -> list[EvidenceSnippet]:
        query_tokens = set(tokenize(query))
        if not query_tokens:
            return []
        scored: list[tuple[float, int]] = []
        for index, counts in enumerate(self._counts):
            score = sum(
                (1 + math.log(counts[token])) * self._idf.get(token, 0.0)
                for token in query_tokens
                if counts.get(token)
            )
            if score > 0:
                scored.append((score, index))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [
            EvidenceSnippet(
                dataset_id=self._chunks[index].dataset_id,
                title=self._chunks[index].title,
                version=self._chunks[index].version,
                position=self._chunks[index].position,
                text=self._chunks[index].text,
                score=round(score, 4),
            )
            for score, index in scored[:limit]
        ]
