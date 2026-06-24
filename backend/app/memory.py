from collections import deque
from threading import Lock
from typing import Deque, Dict, List

from app.config import get_settings


class ConversationMemory:
    def __init__(self, max_items: int | None = None) -> None:
        self.max_items = max_items or get_settings().max_history
        self._items: Deque[Dict[str, str]] = deque(maxlen=self.max_items)
        self._lock = Lock()

    def add(self, question: str, answer: str, mode: str = "rag") -> None:
        with self._lock:
            self._items.append(
                {
                    "question": question.strip(),
                    "answer": answer.strip(),
                    "mode": mode,
                }
            )

    def list(self) -> List[Dict[str, str]]:
        with self._lock:
            return list(self._items)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def as_prompt_context(self) -> str:
        history = self.list()
        if not history:
            return "No previous questions."

        lines = []
        for index, item in enumerate(history, start=1):
            lines.append(f"{index}. Q: {item['question']}\n   A: {item['answer']}")
        return "\n".join(lines)


chat_memory = ConversationMemory()
rag_memory = ConversationMemory()


def get_memory(mode: str | None = None) -> ConversationMemory:
    if mode == "chat":
        return chat_memory
    if mode == "rag":
        return rag_memory
    return rag_memory


def list_all_histories() -> Dict[str, List[Dict[str, str]]]:
    return {
        "chat": chat_memory.list(),
        "rag": rag_memory.list(),
    }
