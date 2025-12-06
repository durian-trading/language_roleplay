import os
import uuid
import json
import logging
import asyncio
from typing import Dict, AsyncGenerator, Tuple, Optional, Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

# Configure custom logger for app events only
logging.basicConfig(
    level=logging.WARNING,  # Suppress uvicorn INFO logs
    format='%(asctime)s - %(message)s',
    datefmt='%H:%M:%S'
)

# Create app-specific logger
logger = logging.getLogger("app")
logger.setLevel(logging.INFO)

# Suppress uvicorn access logs
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn").setLevel(logging.WARNING)

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
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
PREVIEW_MODELS_ALLOWED = os.environ.get("PREVIEW_MODELS_ALLOWED", "0").lower() in {"1","true","yes"}
# Allow fallback to TTS-only preview models (disabled by default because we request TEXT)
ALLOW_TTS_FALLBACK = os.environ.get("ALLOW_TTS_FALLBACK", "0").lower() in {"1","true","yes"}

# Warn early if Gemini key absent (non-fatal; Ollama still works)
if not GEMINI_API_KEY:
    logger.warning("GEMINI_API_KEY not set; Gemini models will be unavailable.")

# ---------------- Provider Abstraction -----------------

def parse_model(raw: str) -> Tuple[str, str]:
    """Split provider prefix and underlying model name.
    Examples:
      'gemini:gemini-1.5-flash' -> ('gemini','gemini-1.5-flash')
      'llama3.2' -> ('ollama','llama3.2')  (default to ollama)
      'qwen2.5:7b-instruct' -> ('ollama','qwen2.5:7b-instruct')  (treat as full Ollama model)
    """
    if not raw:
        return ("ollama", "llama3.2")
    if ":" in raw:
        p, m = raw.split(":", 1)
        # Only gemini uses provider prefix; all other colon names are full Ollama model identifiers.
        if p.lower() == "gemini":
            m = normalize_gemini_model(m)
            return ("gemini", m)
        # Return entire original string as model for Ollama
        return ("ollama", raw)
    return ("ollama", raw)

# Friendly Gemini model mapping and normalization
GEMINI_FRIENDLY_MAP = {
    # Stable 1.5 family
    "gemini-pro": "gemini-1.5-pro",
    "gemini-1.0-pro": "gemini-1.5-pro",
    "gemini-1.5-pro": "gemini-1.5-pro",
    "gemini-1.5-pro-latest": "gemini-1.5-pro-latest",
    "gemini-1.5-flash": "gemini-1.5-flash",
    "gemini-1.5-flash-latest": "gemini-1.5-flash-latest",
    "pro": "gemini-1.5-pro-latest",
    "flash": "gemini-1.5-flash-latest",
    # Gemini 3 preview variants (explicit only; never auto-fallback unless requested or allowed)
    "gemini-3-pro-preview": "gemini-3-pro-preview",
    "g3-pro": "gemini-3-pro-preview",
    "gemini-3-pro": "gemini-3-pro-preview"  # current documented preview alias
}

def normalize_gemini_model(name: str) -> str:
    key = name.strip().lower()
    return GEMINI_FRIENDLY_MAP.get(key, name)

async def ollama_stream(model: str, prompt: str) -> AsyncGenerator[str, None]:
    url = f"http://{OLLAMA_HOST}/api/generate"
    payload = {"model": model, "prompt": prompt, "stream": True}
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", url, json=payload) as resp:
            if resp.status_code >= 400:
                err_bytes = await resp.aread()
                raise HTTPException(status_code=resp.status_code, detail=f"Ollama error: {err_bytes.decode('utf-8','ignore')}")
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                piece = obj.get("response", "")
                if piece:
                    yield piece
                if obj.get("done"):
                    break

async def ollama_generate(model: str, prompt: str) -> str:
    url = f"http://{OLLAMA_HOST}/api/generate"
    payload = {"model": model, "prompt": prompt, "stream": False}
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail=f"Ollama error: {resp.text}")
        data = resp.json()
        return data.get("response", "")

def _load_gemini() -> Tuple[str, Optional[Any]]:
    """Attempt to load one of the Gemini client libraries.
    Returns a tuple (variant, client_or_module).
    variant: 'generativeai' | 'genai' | 'missing'
    """
    if not GEMINI_API_KEY:
        return ("missing", None)
    try:
        import google.generativeai as genai  # old library
        genai.configure(api_key=GEMINI_API_KEY)
        return ("generativeai", genai)
    except ImportError:
        try:
            from google.genai import Client  # new library
            client = Client(api_key=GEMINI_API_KEY)
            return ("genai", client)
        except ImportError:
            return ("missing", None)

async def gemini_stream(model: str, prompt: str) -> AsyncGenerator[str, None]:
    variant, obj = _load_gemini()
    if variant == "missing":
        raise HTTPException(status_code=500, detail="No Gemini client library installed or API key missing")

    if variant == "generativeai":
        try:
            model_obj = obj.GenerativeModel(model)
            response = model_obj.generate_content(prompt, stream=True)
            for chunk in response:
                text = getattr(chunk, "text", None)
                if text:
                    yield text
        except Exception as e:
            msg = str(e)
            if "response modalities" in msg.lower():
                raise HTTPException(status_code=400, detail=f"Model '{model}' does not support TEXT output (likely TTS-only). Choose a text-capable model such as 'gemini-1.5-flash-latest' or 'gemini-1.5-pro-latest'.")
            if "429" in msg or "quota" in msg.lower():
                raise HTTPException(status_code=429, detail=f"Gemini quota exceeded for model '{model}'. Switch to a local Ollama model or upgrade your plan.")
            raise
    elif variant == "genai":
        # obj is a google.genai.Client instance
        # new SDK: streaming via client.responses.stream_generate_content (if available)
        # Fallback to models.stream_generate_content for older minor versions.
        stream_fn = getattr(getattr(obj, "responses", None), "stream_generate_content", None)
        try:
            if stream_fn:
                stream = stream_fn(model=model, contents=prompt)
            else:
                models_iface = getattr(obj, "models", None)
                if not models_iface:
                    raise HTTPException(status_code=500, detail="Gemini client missing streaming interface")
                stream = models_iface.stream_generate_content(model=model, contents=prompt)
            for event in stream:
                text = getattr(event, "text", None) or getattr(event, "output_text", None)
                if text:
                    yield text
        except Exception as e:
            msg = str(e)
            if "response modalities" in msg.lower():
                raise HTTPException(status_code=400, detail=f"Model '{model}' does not support TEXT output (likely TTS-only). Choose a text-capable model such as 'gemini-1.5-flash-latest' or 'gemini-1.5-pro-latest'.")
            if "429" in msg or "quota" in msg.lower():
                raise HTTPException(status_code=429, detail=f"Gemini quota exceeded for model '{model}'. Switch to a local Ollama model or upgrade your plan.")
            raise
    else:
        raise HTTPException(status_code=500, detail="Unsupported Gemini variant")

async def gemini_generate(model: str, prompt: str) -> str:
    variant, obj = _load_gemini()
    if variant == "missing":
        raise HTTPException(status_code=500, detail="No Gemini client library installed or API key missing")
    if variant == "generativeai":
        try:
            m = obj.GenerativeModel(model)
            resp = m.generate_content(prompt, stream=False)
            return getattr(resp, "text", "") or ""
        except Exception as e:
            msg = str(e)
            if "response modalities" in msg.lower():
                raise HTTPException(status_code=400, detail=f"Model '{model}' does not support TEXT output (likely TTS-only). Choose a text-capable model such as 'gemini-1.5-flash-latest' or 'gemini-1.5-pro-latest'.")
            if "429" in msg or "quota" in msg.lower():
                raise HTTPException(status_code=429, detail=f"Gemini quota exceeded for model '{model}'. Switch to a local Ollama model or upgrade your plan.")
            raise
    elif variant == "genai":
        # Try responses.generate_content first
        try:
            gen_fn = getattr(getattr(obj, "responses", None), "generate_content", None)
            if gen_fn:
                resp = gen_fn(model=model, contents=prompt)
            else:
                models_iface = getattr(obj, "models", None)
                if not models_iface:
                    raise HTTPException(status_code=500, detail="Gemini client missing generate interface")
                resp = models_iface.generate_content(model=model, contents=prompt)
            return getattr(resp, "output_text", "") or getattr(resp, "text", "") or ""
        except Exception as e:
            msg = str(e)
            if "response modalities" in msg.lower():
                raise HTTPException(status_code=400, detail=f"Model '{model}' does not support TEXT output (likely TTS-only). Choose a text-capable model such as 'gemini-1.5-flash-latest' or 'gemini-1.5-pro-latest'.")
            if "429" in msg or "quota" in msg.lower():
                raise HTTPException(status_code=429, detail=f"Gemini quota exceeded for model '{model}'. Switch to a local Ollama model or upgrade your plan.")
            raise
    else:
        raise HTTPException(status_code=500, detail="Unsupported Gemini variant")

async def provider_stream(raw_model: str, prompt: str) -> AsyncGenerator[str, None]:
    provider, name = parse_model(raw_model)
    if provider == "gemini":
        available = await list_gemini_models()
        if available and name not in available:
            requested_is_preview = "preview" in name
            # Candidate alternates (prefer same base without -latest or with -latest)
            alternates = []
            if name.endswith("-latest"):
                alternates.append(name.replace("-latest", ""))
            else:
                alternates.append(name + "-latest")
            # Stable fallbacks
            stable_order = ["gemini-1.5-pro-latest","gemini-1.5-flash-latest","gemini-1.5-pro","gemini-1.5-flash"]
            # If user explicitly requested a preview model and previews are available AND allowed, keep it raising error if absent
            if requested_is_preview and not PREVIEW_MODELS_ALLOWED:
                raise HTTPException(status_code=400, detail="Preview models disabled. Set PREVIEW_MODELS_ALLOWED=1 to enable.")
            chosen = None
            for alt in alternates:
                if alt in available:
                    chosen = alt
                    logger.info(f"Switching Gemini model '{name}' -> '{chosen}'")
                    break
            if not chosen:
                # Choose first stable available
                for s in stable_order:
                    if s in available:
                        chosen = s
                        logger.warning(f"Requested Gemini model '{name}' not available; using stable fallback '{chosen}'.")
                        break
            if not chosen:
                # As last resort optionally allow preview if env enabled
                if PREVIEW_MODELS_ALLOWED:
                    previews = [m for m in available if "preview" in m and (ALLOW_TTS_FALLBACK or ("-tts" not in m and "-speech" not in m))]
                    if previews:
                        chosen = previews[0]
                        logger.warning(f"Using preview fallback '{chosen}'.")
            if not chosen:
                raise HTTPException(status_code=404, detail=f"Gemini model '{name}' not available and no stable fallback found.")
            name = chosen
        async for piece in gemini_stream(name, prompt):
            yield piece
    else:  # default ollama
        async for piece in ollama_stream(name, prompt):
            yield piece

async def provider_generate(raw_model: str, prompt: str) -> str:
    provider, name = parse_model(raw_model)
    if provider == "gemini":
        available = await list_gemini_models()
        if available and name not in available:
            requested_is_preview = "preview" in name
            if requested_is_preview and not PREVIEW_MODELS_ALLOWED:
                raise HTTPException(status_code=400, detail="Preview models disabled. Set PREVIEW_MODELS_ALLOWED=1 to enable.")
            alternates = []
            if name.endswith("-latest"):
                alternates.append(name.replace("-latest", ""))
            else:
                alternates.append(name + "-latest")
            stable_order = ["gemini-1.5-pro-latest","gemini-1.5-flash-latest","gemini-1.5-pro","gemini-1.5-flash"]
            chosen = None
            for alt in alternates:
                if alt in available:
                    chosen = alt
                    logger.info(f"Switching Gemini model '{name}' -> '{chosen}'")
                    break
            if not chosen:
                for s in stable_order:
                    if s in available:
                        chosen = s
                        logger.warning(f"Requested Gemini model '{name}' not available; using stable fallback '{chosen}'.")
                        break
            if not chosen and PREVIEW_MODELS_ALLOWED:
                previews = [m for m in available if "preview" in m and (ALLOW_TTS_FALLBACK or ("-tts" not in m and "-speech" not in m))]
                if previews:
                    chosen = previews[0]
                    logger.warning(f"Using preview fallback '{chosen}'.")
            if not chosen:
                raise HTTPException(status_code=404, detail=f"Gemini model '{name}' not available and no stable fallback found.")
            name = chosen
        return await gemini_generate(name, prompt)
    return await ollama_generate(name, prompt)

# -------- Provider / Model Introspection ---------
async def list_gemini_models() -> Optional[set]:
    variant, obj = _load_gemini()
    if variant == "missing":
        return None
    models = set()
    try:
        def _filter(name: str) -> bool:
            # Exclude preview unless env allows or explicitly requested later
            if "preview" in name.lower() and not PREVIEW_MODELS_ALLOWED:
                return False
            return True
        if variant == "generativeai":
            for m in obj.list_models():
                caps = getattr(m, 'supported_generation_methods', []) or []
                raw_name = m.name
                if raw_name.startswith("models/"):
                    raw_name = raw_name[len("models/"):]
                if any(method in caps for method in ("generateContent", "generate_text")) and _filter(raw_name):
                    models.add(raw_name)
        elif variant == "genai":
            list_fn = getattr(getattr(obj, 'models', None), 'list_models', None)
            if list_fn:
                for m in list_fn():
                    name_attr = getattr(m, 'name', None) or getattr(m, 'model', None)
                    if name_attr and name_attr.startswith("models/"):
                        name_attr = name_attr[len("models/"):]
                    if name_attr and _filter(name_attr):
                        models.add(name_attr)
        return models
    except Exception as e:
        logger.warning(f"Failed to list Gemini models: {e}")
        return None

@app.get("/api/providers")
async def providers_info():
    gemini_models = await list_gemini_models()
    return {
        "providers": [
            {
                "name": "ollama",
                "host": OLLAMA_HOST,
                "note": "Local models not enumerated here."
            },
            {
                "name": "gemini",
                "available_models": sorted(gemini_models) if gemini_models else [],
                "friendly_aliases": sorted(GEMINI_FRIENDLY_MAP.keys()),
                "api_key_present": bool(GEMINI_API_KEY)
            }
        ]
    }


@app.post("/api/session")
async def create_session(payload: Dict):
    """Create a new session. Payload can include: learning_language, native_language, situation"""
    sid = str(uuid.uuid4())
    learning_language = payload.get("learning_language")
    native_language = payload.get("native_language")
    situation = payload.get("situation")
    model = payload.get("model", "gemini:gemini-2.5-flash")
    
    SESSIONS[sid] = {
        "id": sid, 
        "learning_language": learning_language, 
        "native_language": native_language,
        "situation": situation,
        "messages": []
    }
    
    # Generate initial greeting from assistant
    initial_prompt = (
        f"You are starting a roleplay conversation in {learning_language}. "
        f"The situation is: {situation}. "
        f"IMPORTANT: Based on this situation, determine what role YOU should play (the opposite/complementary role to the user). "
        f"For example:\n"
        f"- If the situation involves ordering/buying, you are the waiter/seller/staff\n"
        f"- If it involves asking for help/directions, you are the helper/local person\n"
        f"- If it involves service, you are the service provider\n"
        f"Greet the user and start the conversation naturally in {learning_language} from YOUR role perspective. "
        f"Keep it brief (1-2 sentences). Do not add translations or explanations."
    )
    
    try:
        greeting = await provider_generate(model, initial_prompt)
        SESSIONS[sid]["messages"].append({"role": "assistant", "text": greeting})
        initial_message = greeting
        # Also translate the greeting to the user's native language
        if native_language and learning_language and greeting:
            translation_prompt = (
                f"Translate the following {learning_language} text to {native_language}. "
                f"Provide ONLY the translation, no explanations:\n\n\"{greeting}\""
            )
            try:
                initial_translation = await provider_generate(model, translation_prompt)
            except Exception:
                initial_translation = None
        else:
            initial_translation = None
    except Exception as e:
        logger.error(f"Failed to generate initial greeting: {e}")
        initial_message = None
        initial_translation = None
    
    logger.info(f"Created session {sid}: model={model}, learning={learning_language}, native={native_language}, situation={situation}")
    if initial_message:
        logger.info(f"Initial greeting session={sid} model={model}: {initial_message[:160].replace('\n',' ')}")
    return {"session_id": sid, "initial_message": initial_message, "initial_translation": initial_translation}


@app.post("/api/suggest-situation")
async def suggest_situation():
    """Generate a random roleplay situation suggestion"""
    prompt = (
        "Generate a single short roleplay situation description suitable for language learning practice. "
        "Examples: 'Ordering food at a restaurant', 'Asking for directions in a new city', 'Making a hotel reservation'. "
        "Provide only the situation description, nothing else. Keep it to one sentence, 5-15 words."
    )
    try:
        suggestion = await call_ollama(prompt, "llama3.2")
        # Clean up the response (remove quotes, extra whitespace, etc)
        suggestion = suggestion.strip().strip('"\"').strip()
        logger.info(f"Generated situation suggestion: {suggestion}")
        return {"suggestion": suggestion}
    except Exception as e:
        logger.error(f"Failed to generate suggestion: {e}")
        return {"suggestion": "Ordering food at a restaurant"}


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    s = SESSIONS.get(session_id)
    if not s:
        logger.warning(f"Session not found: {session_id}")
        raise HTTPException(status_code=404, detail="session not found")
    logger.info(f"Retrieved session: {session_id}")
    return s


# legacy helper retained for potential direct calls
async def call_ollama(prompt: str, model: str = "llama3.2") -> str:
    return await ollama_generate(model, prompt)


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
    model = body.get("model", "gemini:gemini-2.5-flash")
    
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
        f"IMPORTANT: You should take the OPPOSITE or COMPLEMENTARY role to the user. "
        f"For example:\n"
        f"- If the user is ordering/buying something, you are the waiter/seller/staff\n"
        f"- If the user is asking for help, you are the helper/assistant\n"
        f"- If the user is a customer, you are the service provider\n"
        f"- If the user is a guest, you are the host\n\n"
        f"Conversation so far:\n{conversation}\n\n"
        f"Reply ONLY in {learning_language} (keep it natural and appropriate for your role). "
        f"Do not add any translations or explanations, just the reply."
    )

    # PROMPT 2: Provide feedback on user's message
    feedback_prompt = (
        f"The user is learning {learning_language}. They said: \"{text}\"\n\n"
        f"Analyze this sentence and respond ONLY in {native_language}. Use {native_language} script, not any other language.\n"
        f"- If there's a grammar, vocabulary, or spelling error: state the correction concisely\n"
        f"- If the sentence is completely correct: respond with just \"✓\"\n"
        f"Be factual and direct. Do not praise or encourage. Maximum 20 words.\n"
        f"Do not translate to or include any words in other languages."
    )

    async def stream_generator():
        try:
            # Step 1: Generate reply in learning language (stream abstraction)
            yield json.dumps({"type": "status", "message": "Generating reply..."}) + "\n"
            reply_accum = ""
            async for piece in provider_stream(model, reply_prompt):
                reply_accum += piece
                yield json.dumps({"type": "reply", "text": reply_accum}) + "\n"
            reply_text = reply_accum
            logger.info(f"Assistant reply session={sid} model={model} chars={len(reply_text)} preview={reply_text[:160].replace('\n',' ')}")
            session["messages"].append({"role": "assistant", "text": reply_text})

            # Step 2: Translate reply to native language
            yield json.dumps({"type": "status", "message": "Translating..."}) + "\n"
            translation_prompt = (
                f"Translate the following {learning_language} text to {native_language}. "
                f"Provide ONLY the translation, no explanations:\n\n\"{reply_text}\""
            )
            translation = await provider_generate(model, translation_prompt)
            yield json.dumps({"type": "translation", "text": translation}) + "\n"

            # Step 3: Generate feedback on user's message
            yield json.dumps({"type": "status", "message": "Analyzing your message..."}) + "\n"
            feedback = await provider_generate(model, feedback_prompt)
            yield json.dumps({"type": "feedback", "text": feedback}) + "\n"

            # Signal completion
            yield json.dumps({"type": "done"}) + "\n"
            logger.info(f"Completed message for session {sid}")
            
        except Exception as e:
            logger.error(f"Error in stream_generator for session {sid}: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(stream_generator(), media_type="application/json")


if __name__ == "__main__":
    import uvicorn
    
    # Run with access log disabled to only show custom app logs
    uvicorn.run(
        "server:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True,
        access_log=False,  # Disable HTTP access logs
        log_level="warning"  # Only show warnings/errors from uvicorn
    )
