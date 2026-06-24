from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List

from app.config import get_settings


SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".md"}
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024


def load_cv_text(path: Path | None = None) -> str:
    if path:
        document = _load_single_document(Path(path))
        return document["text"]

    documents = load_cv_documents()
    return "\n\n".join(f"Document: {doc['source']}\n{doc['text']}" for doc in documents)


def load_cv_documents() -> List[Dict[str, str]]:
    paths = get_active_cv_paths()
    if not paths:
        raise FileNotFoundError("No CV has been uploaded yet. Upload one or more CVs before using CV RAG.")
    return [_load_single_document(path) for path in paths]


def _load_single_document(path: Path) -> Dict[str, str]:
    if not path.exists():
        raise FileNotFoundError(f"The uploaded CV was not found: {path.name}. Upload the CV again.")

    suffix = path.suffix.lower()
    if suffix == ".pdf":
        text = _load_pdf(path)
    elif suffix in {".txt", ".md"}:
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            raise ValueError(f"The CV text file is empty: {path.name}.")
    else:
        raise ValueError("Unsupported CV format. Use PDF, TXT, or Markdown.")

    return {"source": path.name, "text": text}


def _load_pdf(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    text = "\n".join(pages).strip()
    if not text:
        raise ValueError(f"The CV PDF did not contain extractable text: {path.name}.")
    return text


def get_active_cv_paths() -> List[Path]:
    data_dir = Path(__file__).resolve().parent.parent / "data"
    if not data_dir.exists():
        return []
    return sorted(
        [
            path
            for path in data_dir.iterdir()
            if path.is_file() and path.name.startswith("uploaded_cv_") and path.suffix.lower() in SUPPORTED_EXTENSIONS
        ],
        key=lambda path: path.stat().st_mtime,
    )


def get_active_cv_path() -> Path | None:
    paths = get_active_cv_paths()
    return paths[-1] if paths else None


def save_uploaded_cv(filename: str, content: bytes) -> Path:
    return save_uploaded_cvs([(filename, content)])[0]


def save_uploaded_cvs(files: List[tuple[str, bytes]]) -> List[Path]:
    if not files:
        raise ValueError("Upload at least one CV file.")

    settings = get_settings()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)

    saved_paths = []
    for index, (filename, content) in enumerate(files, start=1):
        suffix = Path(filename).suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            raise ValueError("Only PDF, TXT, and Markdown CV files are supported.")
        if not content:
            raise ValueError(f"Uploaded CV file is empty: {filename}.")
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise ValueError(f"CV file is too large: {filename}. Maximum size is 5 MB.")
        if suffix in {".txt", ".md"} and not content.decode("utf-8", errors="ignore").strip():
            raise ValueError(f"Uploaded CV text file is empty: {filename}.")

        safe_stem = _safe_filename(Path(filename).stem) or f"cv_{index}"
        destination = _unique_destination(settings.upload_dir, safe_stem, suffix)
        destination.write_bytes(content)
        saved_paths.append(destination)

    return saved_paths


def clear_uploaded_cv() -> bool:
    settings = get_settings()
    removed = False
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    for existing in settings.upload_dir.glob("uploaded_cv_*"):
        if existing.is_file() and existing.suffix.lower() in SUPPORTED_EXTENSIONS:
            existing.unlink(missing_ok=True)
            removed = True
    return removed


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", value).strip("._-")
    return cleaned[:80]


def _unique_destination(directory: Path, stem: str, suffix: str) -> Path:
    candidate = directory / f"uploaded_cv_{stem}{suffix}"
    counter = 2
    while candidate.exists():
        candidate = directory / f"uploaded_cv_{stem}_{counter}{suffix}"
        counter += 1
    return candidate
