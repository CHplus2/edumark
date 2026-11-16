"""Provider-agnostic LLM client (OpenAI-compatible chat completions) + offline mock."""
import asyncio
import json
import os
import re
import random

import httpx

BASE_URL = lambda: os.getenv("LLM_BASE_URL", "").rstrip("/")
API_KEY = lambda: os.getenv("LLM_API_KEY", "")
MODEL = lambda: os.getenv("LLM_MODEL", "")


class LLMError(Exception):
    pass


def is_mock() -> bool:
    return not API_KEY()


async def chat_json(system: str, user: str, retries: int = 4) -> dict:
    if is_mock():
        return _mock(user)
    headers = {"Authorization": f"Bearer {API_KEY()}"}
    body = {
        "model": MODEL(),
        "temperature": 0.2,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    last = "unknown error"
    async with httpx.AsyncClient(timeout=90) as client:
        for attempt in range(retries):
            try:
                r = await client.post(f"{BASE_URL()}/chat/completions", json=body, headers=headers)
                if r.status_code in (429, 500, 502, 503, 504):
                    last = f"provider returned {r.status_code}"
                    await asyncio.sleep(2 ** attempt + random.random())
                    continue
                if r.status_code in (401, 403):
                    raise LLMError("API key rejected by provider.")
                r.raise_for_status()
                text = r.json()["choices"][0]["message"]["content"]
                return parse_json(text)
            except LLMError:
                raise
            except (ValueError, KeyError) as e:   # bad JSON / unexpected shape: retry
                last = f"invalid model output ({e})"
            except httpx.HTTPError as e:
                last = f"network error ({e.__class__.__name__})"
                await asyncio.sleep(2 ** attempt)
    raise LLMError(f"LLM failed after {retries} attempts: {last}")


def parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ValueError("no JSON object found")
        return json.loads(m.group(0))


def _mock(user: str) -> dict:
    m = re.search(r"TOTAL_MARKS: ([\d.]+)", user)
    total = float(m.group(1)) if m else 100
    score = round(total * random.uniform(0.5, 0.9), 1)
    return {
        "criteria": [{"name": "Overall (mock)", "score": score, "max": total, "comment": "Mock marker: no API key set."}],
        "total_score": score,
        "feedback": "Mock feedback. Set LLM_API_KEY in .env to use a real model.",
        "confidence": random.choice(["low", "medium", "high"]),
    }
