from __future__ import annotations

from typing import Annotated

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.chatbot import chatbot
from app.config import BASE_DIR, get_settings
from app.cv_loader import clear_uploaded_cv, get_active_cv_paths, save_uploaded_cv, save_uploaded_cvs
from app.memory import chat_memory, list_all_histories, rag_memory
from app.open_source_llm import open_source_llm
from app.rag import get_rag


settings = get_settings()
app = FastAPI(
    title="CV Intelligence RAG Chatbot API",
    version="1.0.0",
    description=(
        "FastAPI service for general chatbot questions, CV-based RAG answers, "
        "multi-CV upload, source-backed retrieval, and separate 10-turn memories."
    ),
    contact={"name": "Haider Ali", "url": "https://github.com/haiderrrrrrr/cv-intelligence-rag-chatbot"},
    openapi_tags=[
        {"name": "System", "description": "Health and root endpoints."},
        {"name": "Chatbot", "description": "General chatbot and optional lightweight local LLM endpoints."},
        {"name": "CV RAG", "description": "CV upload, document management, and retrieval-augmented answers."},
        {"name": "Memory", "description": "Separate 10-turn histories for chatbot and CV RAG conversations."},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = BASE_DIR / "frontend"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


class QuestionRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        title="Question",
        description="Meaningful natural-language question to send to the chatbot or CV RAG pipeline.",
        examples=[
            "Explain what this project does in simple words.",
            "What skills are mentioned in the uploaded CV?",
        ],
    )


@app.get("/", tags=["System"], summary="API root")
def home():
    index_file = static_dir / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": settings.app_name, "docs": "/docs"}


@app.get(
    "/health",
    tags=["System"],
    summary="Check API health",
    description="Returns API status, configured Gemini model, CV upload state, and memory counts.",
)
def health():
    active_cvs = get_active_cv_paths()
    return {
        "status": "ok",
        "app": settings.app_name,
        "model": settings.gemini_model,
        "gemini_key_configured": bool(settings.gemini_api_key),
        "max_history": settings.max_history,
        "active_cv": str(active_cvs[-1]) if active_cvs else None,
        "active_cvs": [path.name for path in active_cvs],
        "cv_count": len(active_cvs),
        "cv_uploaded": bool(active_cvs),
        "chat_history_count": len(chat_memory.list()),
        "rag_history_count": len(rag_memory.list()),
    }


@app.post(
    "/upload-cv",
    tags=["CV RAG"],
    summary="Upload one CV",
    description="Uploads one PDF, TXT, or MD CV file and clears the existing CV RAG memory/index.",
)
async def upload_cv(file: UploadFile = File(..., description="Single CV file. Supported formats: PDF, TXT, MD.")):
    try:
        content = await file.read()
        saved_path = save_uploaded_cv(file.filename or "uploaded_cv.txt", content)
        get_rag.cache_clear()
        rag_memory.clear()
        return {
            "status": "uploaded",
            "filename": file.filename,
            "saved_as": str(saved_path),
            "cv_count": len(get_active_cv_paths()),
            "active_cvs": [path.name for path in get_active_cv_paths()],
            "message": "CV uploaded. Existing RAG memory was cleared and the index will rebuild on the next CV question.",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post(
    "/upload-cvs",
    tags=["CV RAG"],
    summary="Upload multiple CVs",
    description="Uploads a batch of CV files and makes them the active retrieval corpus.",
)
async def upload_cvs(files: list[UploadFile] = File(..., description="One or more CV files. Supported formats: PDF, TXT, MD.")):
    try:
        payload = []
        for file in files:
            payload.append((file.filename or "uploaded_cv.txt", await file.read()))
        saved_paths = save_uploaded_cvs(payload)
        get_rag.cache_clear()
        rag_memory.clear()
        active_cvs = get_active_cv_paths()
        return {
            "status": "uploaded",
            "filenames": [file.filename for file in files],
            "saved_as": [str(path) for path in saved_paths],
            "cv_count": len(active_cvs),
            "active_cvs": [path.name for path in active_cvs],
            "message": "CV batch uploaded. Existing RAG memory was cleared and the index will rebuild on the next CV question.",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get(
    "/cvs",
    tags=["CV RAG"],
    summary="List active CVs",
    description="Lists uploaded CV files currently available to the RAG pipeline.",
)
def list_cvs():
    active_cvs = get_active_cv_paths()
    return {
        "count": len(active_cvs),
        "items": [{"filename": path.name, "path": str(path), "size_bytes": path.stat().st_size} for path in active_cvs],
    }


@app.delete(
    "/cv",
    tags=["CV RAG"],
    summary="Clear CV workspace",
    description="Deletes uploaded CV files, clears the RAG index cache, and clears CV RAG memory.",
)
def delete_cv():
    removed = clear_uploaded_cv()
    get_rag.cache_clear()
    rag_memory.clear()
    return {
        "status": "removed" if removed else "not_found",
        "cv_uploaded": False,
        "message": "Current CV, RAG index, and RAG memory were cleared.",
    }


@app.post(
    "/chat",
    tags=["Chatbot"],
    summary="Ask the general chatbot",
    description="Answers a general question and stores the turn in the separate chatbot memory.",
)
def chat(payload: QuestionRequest):
    try:
        answer = chatbot.ask(payload.question)
        chat_memory.add(payload.question, answer, mode="chat")
        return {
            "question": payload.question,
            "answer": answer,
            "history_count": len(chat_memory.list()),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post(
    "/ask",
    tags=["CV RAG"],
    summary="Ask a CV RAG question",
    description="Retrieves relevant uploaded CV chunks, sends them to the chatbot, and returns an answer with sources.",
)
def ask_cv(payload: QuestionRequest):
    try:
        return get_rag().answer(payload.question)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"RAG pipeline failed: {exc}") from exc


@app.post(
    "/open-source-chat",
    tags=["Chatbot"],
    summary="Ask the optional lightweight local LLM",
    description="Uses the optional local open-source LLM module and stores the turn in chatbot memory.",
)
def open_source_chat(payload: QuestionRequest):
    try:
        answer = open_source_llm.ask(payload.question)
        chat_memory.add(payload.question, answer, mode="open_source")
        return {
            "question": payload.question,
            "answer": answer,
            "history_count": len(chat_memory.list()),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Open-source LLM failed: {exc}") from exc


@app.get(
    "/history",
    tags=["Memory"],
    summary="Read conversation history",
    description="Reads all memory or one memory stream. Each stream keeps the latest configured 10 turns.",
)
def get_history(mode: Annotated[str, Query(description="History mode to read: all, chat, or rag.")] = "all"):
    if mode == "chat":
        items = chat_memory.list()
        return {"mode": "chat", "count": len(items), "items": items}
    if mode == "rag":
        items = rag_memory.list()
        return {"mode": "rag", "count": len(items), "items": items}
    histories = list_all_histories()
    return {
        "mode": "all",
        "count": len(histories["chat"]) + len(histories["rag"]),
        "chat_count": len(histories["chat"]),
        "rag_count": len(histories["rag"]),
        "items": histories,
    }


@app.get("/history/chat", tags=["Memory"], summary="Read chatbot memory")
def get_chat_history():
    items = chat_memory.list()
    return {"mode": "chat", "count": len(items), "items": items}


@app.get("/history/rag", tags=["Memory"], summary="Read CV RAG memory")
def get_rag_history():
    items = rag_memory.list()
    return {"mode": "rag", "count": len(items), "items": items}


@app.delete(
    "/history",
    tags=["Memory"],
    summary="Clear conversation history",
    description="Clears all memory or one memory stream.",
)
def clear_history(mode: Annotated[str, Query(description="History mode to clear: all, chat, or rag.")] = "all"):
    if mode == "chat":
        chat_memory.clear()
        return {"status": "cleared", "mode": "chat", "count": 0}
    if mode == "rag":
        rag_memory.clear()
        return {"status": "cleared", "mode": "rag", "count": 0}
    chat_memory.clear()
    rag_memory.clear()
    return {"status": "cleared", "mode": "all", "count": 0}


@app.delete("/history/chat", tags=["Memory"], summary="Clear chatbot memory")
def clear_chat_history():
    chat_memory.clear()
    return {"status": "cleared", "mode": "chat", "count": 0}


@app.delete("/history/rag", tags=["Memory"], summary="Clear CV RAG memory")
def clear_rag_history():
    rag_memory.clear()
    return {"status": "cleared", "mode": "rag", "count": 0}
