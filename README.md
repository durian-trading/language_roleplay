# Language Roleplay — minimal starter

This repo contains a tiny example architecture for a language-learning roleplay app.

Structure
- frontend/  — minimal React + Vite UI (chat, session creation, streams backend responses)
- backend/   — FastAPI server that manages sessions and proxies streaming calls to an LLM server (e.g., Ollama)
- ollama_test.html — one-file quick test UI to call Ollama directly (already present)
- llm_context.md — notes and recommended system prompt for streaming

Quick start (development)

1) Start your local Ollama server (example):

   OLLAMA_HOST=127.0.0.1:11435 ollama serve

2) Backend (proxy + session manager)

   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   export OLLAMA_HOST=127.0.0.1:11435
   python server.py

   Backend runs on http://127.0.0.1:8000 by default.

3) Frontend (Vite)

   cd frontend
   npm install
   npm run dev

   Open the browser to the Vite dev URL (usually http://localhost:5173)

Notes
- The frontend is intentionally minimal — it creates a session and posts user messages to `/api/message`. The backend forwards streaming newline-delimited JSON lines from the LLM (Ollama) to the frontend which concatenates `response` fields.
- The app keeps session history in-memory and resets on backend restart.
- You can use the standalone `ollama_test.html` as a quick test page (no backend) — it connects directly to the Ollama server (subject to CORS).
