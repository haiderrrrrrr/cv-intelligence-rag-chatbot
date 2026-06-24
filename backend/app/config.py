from functools import lru_cache
import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


BASE_DIR = Path(__file__).resolve().parent.parent


def resolve_project_path(value: str | Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return BASE_DIR / path


class Settings:
    app_name: str = "RAG Chatbot API"
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
    embedding_model: str = os.getenv(
        "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
    )
    chunk_size: int = int(os.getenv("CHUNK_SIZE", "900"))
    chunk_overlap: int = int(os.getenv("CHUNK_OVERLAP", "160"))
    top_k: int = int(os.getenv("TOP_K", "4"))
    max_history: int = int(os.getenv("MAX_HISTORY", "10"))
    upload_dir: Path = resolve_project_path(os.getenv("UPLOAD_DIR", "data"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
