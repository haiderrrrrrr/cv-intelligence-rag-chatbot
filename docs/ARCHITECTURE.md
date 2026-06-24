# Architecture Notes

## System Architecture

```txt
Next.js Frontend
  - Chat UI
  - CV upload
  - History display
  - Calls FastAPI over HTTP

FastAPI Backend
  - /chat for general questions
  - /ask for CV RAG
  - /upload-cv for CV ingestion
  - /history for latest 10 Q&A context

RAG Layer
  - PyPDF/TXT loader
  - Text chunking
  - SentenceTransformer embeddings
  - FAISS vector retrieval
  - Gemini answer generation

Docker
  - backend container
  - frontend container
  - docker-compose orchestration
```

## Enterprise Upgrade Path

- Authentication with user accounts and organizations
- Per-user document workspaces
- Object storage for original CV files
- Database storage for chat history and document metadata
- Persistent vector index per document or user
- Background workers for indexing large documents
- Streaming answers from the backend to the UI
- Rate limiting and request logging
- Observability with structured logs and metrics
- Role-based access control for shared CV libraries

The current implementation keeps the system lightweight while preserving clear boundaries between frontend, API, RAG, document loading, and memory management.
