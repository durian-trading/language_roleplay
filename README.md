# Language Roleplay — minimal starter

This repo contains a tiny example architecture for a language-learning roleplay app.

Structure
- frontend/  — minimal React + Vite UI (chat, session creation, streams backend responses)
- backend/   — FastAPI server that manages sessions and proxies streaming calls to an LLM server (e.g., Ollama)
- ollama_test.html — one-file quick test UI to call Ollama directly (already present)
- llm_context.md — notes and recommended system prompt for streaming

Quick start (development)

Launch 4 servers in separate terminals:

**Terminal 1 - Ollama (local models, port 11435):**
```bash
OLLAMA_HOST=127.0.0.1:11435 ollama serve
```

**Terminal 2 - Backend API (FastAPI, port 8000):**
```bash
cd backend
source venv/bin/activate
export OLLAMA_HOST=127.0.0.1:11435
export GEMINI_API_KEY=your_key_here  # Optional, for Gemini models
export PREVIEW_MODELS_ALLOWED=0      # Set to 1 to enable Gemini preview models
python server.py
```

**Terminal 3 - Frontend (Vite dev server, port 5173):**
```bash
cd frontend
npm install
npm run dev
```

**Terminal 4 - Ngrok (optional, for external access):**
```bash
ngrok http 8000
```

Open browser to http://localhost:5173

Notes
- The frontend is intentionally minimal — it creates a session and posts user messages to `/api/message`. The backend forwards streaming newline-delimited JSON lines from the LLM (Ollama) to the frontend which concatenates `response` fields.
- The app keeps session history in-memory and resets on backend restart.
- You can use the standalone `ollama_test.html` as a quick test page (no backend) — it connects directly to the Ollama server (subject to CORS).
