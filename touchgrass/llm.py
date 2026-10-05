"""Client for a local Ollama server running an open-weight model.

Everything stays on hardware you control: the bot sends prompts and photos to
OLLAMA_URL (by default the same machine) and nowhere else. Swap the model with
OLLAMA_MODEL, e.g. gemma3:4b on a laptop, gemma3:12b or qwen2.5vl on a bigger box.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import urllib.error
import urllib.request

from touchgrass import config

LOGGER = logging.getLogger("touchgrass.llm")


class LLMError(Exception):
    pass


def _post(path: str, payload: dict, timeout: float) -> dict:
    req = urllib.request.Request(
        config.OLLAMA_URL + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")[:200]
        raise LLMError(f"Ollama returned HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise LLMError(f"Can't reach Ollama at {config.OLLAMA_URL}: {e}") from e


async def chat(
    prompt: str,
    system: str = "",
    images: list[bytes] | None = None,
    schema: dict | None = None,
    temperature: float = 0.7,
    timeout: float = 120,
) -> str:
    """One-shot chat with the local model. Returns the reply text."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    user = {"role": "user", "content": prompt}
    if images:
        user["images"] = [base64.b64encode(img).decode() for img in images]
    messages.append(user)
    payload = {
        "model": config.MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature},
    }
    if schema:
        payload["format"] = schema  # Ollama structured outputs: the reply must match this JSON schema
    data = await asyncio.to_thread(_post, "/api/chat", payload, timeout)
    return (data.get("message") or {}).get("content", "").strip()


async def chat_json(prompt: str, schema: dict, **kwargs) -> dict:
    text = await chat(prompt, schema=schema, temperature=kwargs.pop("temperature", 0.2), **kwargs)
    try:
        return json.loads(text)
    except ValueError as e:
        raise LLMError(f"Model didn't return JSON: {text[:120]}") from e
