import os
import uuid
from typing import Dict

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import logging
from datetime import datetime

# Configure logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="language-roleplay-backend")

# Enable CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store (compact - replace with DB in production)
SESSIONS: Dict[str, Dict] = {}

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "127.0.0.1:11435")


@app.post("/api/session")
async def create_session(payload: Dict):
    """Create a new session. Payload can include: learning_language, native_language, situation"""
    sid = str(uuid.uuid4())
    SESSIONS[sid] = {
        "id": sid, 
        "learning_language": payload.get("learning_language"), 
        "native_language": payload.get("native_language"),
        "situation": payload.get("situation"),
        "messages": []
    }
    logger.info(f"Created session {sid}: learning={payload.get('learning_language')}, native={payload.get('native_language')}, situation={payload.get('situation')}")
    return {"session_id": sid}


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    s = SESSIONS.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="session not found")
    return s


@app.post("/api/message")
async def post_message(request: Request):
    """Accepts JSON {session_id, text, model?} and returns a streamed response from the LLM.

    The backend will forward the LLM streaming output (newline-delimited JSON lines) directly.
    """
    body = await request.json()
    sid = body.get("session_id")
    text = body.get("text")
    model = body.get("model", "llama3")
    logger.info(f"Received message: {text} for session: {sid}")
    logger.info(f"Request: {request}")
    if not text:
        raise HTTPException(status_code=400, detail="missing text")

    session = SESSIONS.get(sid)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    # Append the user message to session history
    session["messages"].append({"role": "user", "text": text})
    learning_language = session.get("learning_language","French")
    native_language = session.get("native_language","English")
    situation = session.get("situation","a casual conversation")

    # Build a simple prompt from history (replace with structured message format if desired)
    conversation = "\n".join([f"{m['role'].capitalize()}: {m['text']}" for m in session["messages"]])
    prompt_text = (f"You are a helpful language learning assistant. "
                   f"The user is learning {learning_language} and speaks {native_language} as their native language. "
                   f"The situation is: {situation}.\n\n"
                   f"{conversation}\n"
                   f"Assistant:")
    url = f"http://{OLLAMA_HOST}/api/generate"
    payload = {"model": model, "prompt": prompt_text, "stream": True}

    async def stream_generator():
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream("POST", url, json=payload) as resp:
                    if resp.status_code >= 400:
                        # forward error
                        text = await resp.aread()
                        yield f"ERROR {resp.status_code}: {text.decode()}\n"
                        return

                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        # Forward each newline-delimited JSON line to the client
                        yield line + "\n"
            except Exception as e:
                yield f"ERROR: {e}\n"

    return StreamingResponse(stream_generator(), media_type="application/json")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
