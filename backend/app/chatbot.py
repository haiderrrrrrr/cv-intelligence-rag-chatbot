from __future__ import annotations

import re

from app.config import get_settings


class Chatbot:
    """Gemini-first chatbot with a graceful local fallback for demos."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self._client = None

    def _get_client(self):
        if not self.settings.gemini_api_key:
            return None
        if self._client is None:
            from google import genai

            self._client = genai.Client(api_key=self.settings.gemini_api_key)
        return self._client

    def ask(self, question: str, system_instruction: str | None = None) -> str:
        question = self._clean_question(question)
        client = self._get_client()

        if client is None:
            return self._fallback_answer(question)

        prompt = question
        if system_instruction:
            prompt = f"{system_instruction.strip()}\n\nUser question:\n{question}"

        try:
            answer = self._generate_with_gemini(client, prompt)
            return answer.strip() or self._fallback_answer(question)
        except Exception as exc:
            return (
                "The Gemini call failed, so I used the local fallback answer. "
                f"Reason: {exc}\n\n{self._fallback_answer(question)}"
            )

    @staticmethod
    def _clean_question(question: str) -> str:
        cleaned = re.sub(r"\s+", " ", question or "").strip()
        if not cleaned:
            raise ValueError("Question cannot be empty.")
        if len(cleaned) > 4000:
            raise ValueError("Question is too long. Please keep it under 4000 characters.")
        return cleaned

    def _generate_with_gemini(self, client, prompt: str) -> str:
        response = client.models.generate_content(
            model=self.settings.gemini_model,
            contents=prompt,
        )
        return getattr(response, "text", "") or ""

    @staticmethod
    def _fallback_answer(question: str) -> str:
        return (
            "I can answer this best when GEMINI_API_KEY is configured. "
            "For now, the local fallback received your question and confirms the API, "
            f"validation, and memory flow are working. Question: {question}"
        )


chatbot = Chatbot()
