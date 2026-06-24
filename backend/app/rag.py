from __future__ import annotations

from functools import lru_cache
from typing import Dict, List

from app.chatbot import chatbot
from app.config import get_settings
from app.cv_loader import load_cv_documents
from app.memory import rag_memory
from app.vector_store import VectorStore, split_documents


class CVRAG:
    def __init__(self) -> None:
        self.settings = get_settings()
        documents = load_cv_documents()
        chunks = split_documents(documents)
        self.store = VectorStore(chunks)

    def answer(self, question: str) -> Dict[str, object]:
        question = question.strip()
        if not question:
            raise ValueError("Question cannot be empty.")

        results = self.store.search(question, self.settings.top_k)
        context = "\n\n".join(
            f"Source {index + 1}: {result.source}, chunk {result.chunk} (score {result.score:.3f}):\n{result.text}"
            for index, result in enumerate(results)
        )
        history = rag_memory.as_prompt_context()

        system_instruction = f"""
You are a precise CV-based RAG assistant.
Use the CV context first. Use conversation history only when it helps resolve follow-up questions.
If the answer is not present in the CV context, say that the CV does not provide that information.
Keep answers professional, specific, and concise.

Previous Q&A history, latest 10:
{history}

CV context:
{context}
"""
        answer = chatbot.ask(question, system_instruction=system_instruction)
        if answer.startswith("I can answer this best when") or answer.startswith("The Gemini call failed"):
            answer = self._extractive_fallback(question, results)
        rag_memory.add(question, answer, mode="rag")
        sources = [
            {
                "chunk": index + 1,
                "document": result.source,
                "document_chunk": result.chunk,
                "score": round(float(result.score), 4),
                "snippet": result.text[:500],
            }
            for index, result in enumerate(results)
        ]

        return {
            "question": question,
            "answer": answer,
            "sources_used": len(results),
            "history_count": len(rag_memory.list()),
            "sources": sources,
            "context_preview": [source["snippet"][:260] for source in sources],
        }

    @staticmethod
    def _extractive_fallback(question: str, results) -> str:
        if not results:
            return "The CV does not provide enough information to answer that question."

        best_context = results[0].text.strip()
        if not best_context:
            return "The CV does not provide enough information to answer that question."

        return (
            "Based on the retrieved CV context, here is the most relevant information:\n\n"
            f"{best_context}\n\n"
            "Gemini was not available for final wording, so this answer is extracted directly from the CV context."
        )


@lru_cache
def get_rag() -> CVRAG:
    return CVRAG()
