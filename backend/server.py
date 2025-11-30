import os
import uuid
from typing import Dict
import json

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


@app.post("/api/suggest-situation")
async def suggest_situation():
    """Generate a random roleplay situation suggestion"""
    prompt = (
        "Generate a single short roleplay situation description suitable for language learning practice. "
        "Examples: 'Ordering food at a restaurant', 'Asking for directions in a new city', 'Making a hotel reservation'. "
        "Provide only the situation description, nothing else. Keep it to one sentence, 5-15 words."
    )
    try:
        suggestion = await call_ollama(prompt, "llama3")
        # Clean up the response (remove quotes, extra whitespace, etc)
        suggestion = suggestion.strip().strip('"\'').strip()
        return {"suggestion": suggestion}
    except Exception as e:
        logger.error(f"Failed to generate suggestion: {e}")
        return {"suggestion": "Ordering food at a restaurant"}


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    s = SESSIONS.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="session not found")
    return s


async def call_ollama(prompt: str, model: str = "llama3") -> str:
    """Helper function to call Ollama and return the complete response text."""
    url = f"http://{OLLAMA_HOST}/api/generate"
    payload = {"model": model, "prompt": prompt, "stream": False}
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail=f"Ollama error: {resp.text}")
        data = resp.json()
        return data.get("response", "")


@app.post("/api/message")
async def post_message(request: Request):
    """Accepts JSON {session_id, text, model?} and returns three outputs:
    1. Assistant reply in learning language
    2. Translation of reply in native language
    3. Feedback on user's message
    """
    body = await request.json()
    sid = body.get("session_id")
    text = body.get("text")
    model = body.get("model", "llama3")
    
    logger.info(f"Received message: {text} for session: {sid}")
    
    if not text:
        raise HTTPException(status_code=400, detail="missing text")

    session = SESSIONS.get(sid)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    # Append the user message to session history
    session["messages"].append({"role": "user", "text": text})
    
    learning_language = session.get("learning_language", "French")
    native_language = session.get("native_language", "English")
    situation = session.get("situation", "a casual conversation")

    # Build conversation history
    conversation = "\n".join([f"{m['role'].capitalize()}: {m['text']}" for m in session["messages"]])

    # PROMPT 1: Generate assistant's reply in learning language
    reply_prompt = (
        f"You are roleplaying in a language learning scenario. "
        f"The user is learning {learning_language}. "
        f"The situation is: {situation}.\n\n"
        f"Conversation so far:\n{conversation}\n\n"
        f"Reply ONLY in {learning_language} (keep it natural and appropriate for the roleplay situation). "
        f"Do not add any translations or explanations, just the reply."
    )

    # PROMPT 2: Provide feedback on user's message
    feedback_prompt = (
        f"You are a language learning assistant. "
        f"The user is learning {learning_language} and their native language is {native_language}. "
        f"The user just said: \"{text}\"\n\n"
        f"Provide brief, constructive feedback on their message in {native_language}. "
        f"Comment on grammar, vocabulary choice, or suggest improvements if needed. Keep the feedback concise. "
    )

    async def stream_generator():
        try:
            # Step 1: Generate reply in learning language
            yield json.dumps({"type": "status", "message": "Generating reply..."}) + "\n"
            reply_text = await call_ollama(reply_prompt, model)
            
            # Save assistant reply to history
            session["messages"].append({"role": "assistant", "text": reply_text})
            
            yield json.dumps({"type": "reply", "text": reply_text}) + "\n"

            # Step 2: Translate reply to native language
            yield json.dumps({"type": "status", "message": "Translating..."}) + "\n"
            translation_prompt = (
                f"Translate the following {learning_language} text to {native_language}. "
                f"Provide ONLY the translation, no explanations:\n\n\"{reply_text}\""
            )
            translation = await call_ollama(translation_prompt, model)
            yield json.dumps({"type": "translation", "text": translation}) + "\n"

            # Step 3: Generate feedback on user's message
            yield json.dumps({"type": "status", "message": "Analyzing your message..."}) + "\n"
            feedback = await call_ollama(feedback_prompt, model)
            yield json.dumps({"type": "feedback", "text": feedback}) + "\n"

            # Signal completion
            yield json.dumps({"type": "done"}) + "\n"
            
        except Exception as e:
            logger.error(f"Error in stream_generator: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(stream_generator(), media_type="application/json")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
