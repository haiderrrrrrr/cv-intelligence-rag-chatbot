from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, List

import numpy as np

from app.config import get_settings


@dataclass
class SearchResult:
    text: str
    score: float
    source: str = "CV"
    chunk: int = 1


def split_text(text: str, chunk_size: int | None = None, overlap: int | None = None) -> List[str]:
    settings = get_settings()
    chunk_size = chunk_size or settings.chunk_size
    overlap = overlap or settings.chunk_overlap

    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        raise ValueError("Cannot build RAG from empty CV text.")

    chunks = []
    start = 0
    while start < len(cleaned):
        end = min(start + chunk_size, len(cleaned))
        chunks.append(cleaned[start:end].strip())
        if end == len(cleaned):
            break
        start = max(0, end - overlap)
    return chunks


def split_documents(documents: List[Dict[str, str]], chunk_size: int | None = None, overlap: int | None = None) -> List[Dict[str, object]]:
    chunks: List[Dict[str, object]] = []
    for document in documents:
        for index, chunk in enumerate(split_text(document["text"], chunk_size, overlap), start=1):
            chunks.append({"text": chunk, "source": document["source"], "chunk": index})
    return chunks


class VectorStore:
    def __init__(self, chunks: List[str] | List[Dict[str, object]]) -> None:
        if not chunks:
            raise ValueError("At least one text chunk is required.")
        self.chunks = [
            chunk if isinstance(chunk, dict) else {"text": chunk, "source": "CV", "chunk": index + 1}
            for index, chunk in enumerate(chunks)
        ]
        self.settings = get_settings()
        self._model = None
        self._index = None
        self._embeddings = None
        self._build()

    def _load_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.settings.embedding_model)
        return self._model

    def _embed(self, texts: List[str]) -> np.ndarray:
        model = self._load_model()
        embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return np.array(embeddings, dtype="float32")

    def _build(self) -> None:
        try:
            import faiss

            self._embeddings = self._embed([str(chunk["text"]) for chunk in self.chunks])
            dimension = self._embeddings.shape[1]
            self._index = faiss.IndexFlatIP(dimension)
            self._index.add(self._embeddings)
        except Exception:
            self._index = None

    def search(self, query: str, top_k: int | None = None) -> List[SearchResult]:
        query = query.strip()
        if not query:
            raise ValueError("Search query cannot be empty.")
        top_k = top_k or self.settings.top_k

        if self._index is not None:
            query_embedding = self._embed([query])
            scores, indices = self._index.search(query_embedding, min(top_k, len(self.chunks)))
            return [
                SearchResult(
                    text=str(self.chunks[index]["text"]),
                    score=float(score),
                    source=str(self.chunks[index]["source"]),
                    chunk=int(self.chunks[index]["chunk"]),
                )
                for score, index in zip(scores[0], indices[0])
                if index >= 0
            ]

        return self._keyword_search(query, top_k)

    def _keyword_search(self, query: str, top_k: int) -> List[SearchResult]:
        query_terms = set(re.findall(r"[a-zA-Z0-9+#.]+", query.lower()))
        results = []
        for chunk in self.chunks:
            text = str(chunk["text"])
            chunk_terms = set(re.findall(r"[a-zA-Z0-9+#.]+", text.lower()))
            overlap = len(query_terms & chunk_terms)
            score = overlap / math.sqrt(max(len(chunk_terms), 1))
            results.append(SearchResult(text=text, score=score, source=str(chunk["source"]), chunk=int(chunk["chunk"])))
        return sorted(results, key=lambda item: item.score, reverse=True)[:top_k]
