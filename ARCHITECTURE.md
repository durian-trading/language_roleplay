# Language Roleplay — Architecture (overview)

This document describes a minimal, extensible architecture for the language-learning roleplay app.

High-level goals
- Frontend: React app that provides a chat-style UI where the user selects a language and roleplay scenario, sends messages, and receives streaming replies plus feedback.
- Backend: Python (FastAPI) provides session management, orchestrates prompts, and proxies streaming responses to avoid CORS in local/dev setups.
- LLM calls: Uses HTTP API calls to an LLM service (Ollama in dev). Backend calls the LLM and forwards streaming results to the frontend.

Actors / components
- Browser (React): UI, conversation state (in-memory while page open), display of streaming assistant tokens, feedback text, translations.
- Backend (FastAPI): session store (in-memory for now), endpoints to create session / step message / fetch history, simple orchestration + LLM proxy.
- LLM server (Ollama): handles model inference and streams newline-delimited JSON.

Data model (simple)
- Session { id, language, roleplay_meta, messages[] }
- Message { role: 'user' | 'assistant' | 'system', text }

API endpoints (minimal)
- POST /api/session -> create session (returns session_id)
- GET /api/session/{id} -> get session & history
- POST /api/message -> send a user message; backend builds full prompt and POSTs to LLM API; returns streaming response (proxied). The frontend concatenates the streamed JSON chunk `response` fields.

Streaming behavior
- Ollama returns newline-delimited JSON chunks (one JSON per line). The frontend expects `{response: string, done: boolean}` chunks. Backend should forward the stream unchanged, or transform if necessary.

Extensibility notes
- Add persistent storage (sqlite, redis) for sessions if you want long-term history.
- Add authentication for real users, per-user sessions.
- Add token limits and prompt trimming on the backend.
- Add offline testing mode (mock LLM responses) for UI development.

Local dev tips
- Set environment variable `OLLAMA_HOST` to the host:port where Ollama is running (default: 127.0.0.1:11435). Backend will proxy to `http://{OLLAMA_HOST}/api/generate` by default.
