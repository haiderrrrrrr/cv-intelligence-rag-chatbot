from __future__ import annotations


class OpenSourceLLM:
    """Lazy lightweight Hugging Face chatbot for the open-source LLM requirement."""

    def __init__(self, model_name: str = "Qwen/Qwen2.5-0.5B-Instruct") -> None:
        self.model_name = model_name
        self._pipeline = None

    def _load(self):
        if self._pipeline is None:
            from transformers import pipeline

            self._pipeline = pipeline(
                "text-generation",
                model=self.model_name,
                device_map="auto",
                max_new_tokens=180,
            )
        return self._pipeline

    def ask(self, question: str) -> str:
        if not question.strip():
            raise ValueError("Question cannot be empty.")

        prompt = (
            "You are a helpful assistant. Answer clearly and concisely.\n\n"
            f"Question: {question.strip()}\nAnswer:"
        )
        generator = self._load()
        output = generator(prompt, do_sample=True, temperature=0.4)[0]["generated_text"]
        return output.split("Answer:", 1)[-1].strip()


open_source_llm = OpenSourceLLM()
