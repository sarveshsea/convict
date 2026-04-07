"""
VLM analyzer — periodic visual analysis of the tank via Gemma (Ollama).

Sends the latest MJPEG snapshot to a locally-running Ollama instance and
returns structured observations about fish count, anomalies, and species.

This runs as a background task every vlm_analysis_interval_s seconds and
never blocks the main detection loop.

Setup (one-time, on Lenovo Yoga 5 or any x86/Linux/Windows machine):
  1. Install Ollama: https://ollama.com/download
  2. Pull the model: ollama pull gemma3:2b   (~1.7 GB)
  3. Set VLM_ENABLED=true in .env.local

For better accuracy with more RAM (16 GB+):
  ollama pull gemma3:4b
  Then set VLM_MODEL=gemma3:4b in .env.local
"""
from __future__ import annotations

import base64
import json
import logging
import re
from datetime import datetime, timezone

from pydantic import BaseModel, Field

log = logging.getLogger("convict.vlm")


class VLMObservation(BaseModel):
    fish_visible: int = 0
    anomalies: list[str] = Field(default_factory=list)
    species_hints: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    raw_response: str = ""
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


_SYSTEM_PROMPT = (
    "You are an expert aquarium biologist. Analyze the fish tank image and reply "
    "with ONLY valid JSON in this exact format, no other text:\n"
    '{"fish_visible": <int>, "anomalies": [<strings>], "species_hints": [<strings>], "confidence": <0.0-1.0>}\n'
    "anomalies: behavioral concerns (e.g. 'fish resting at surface', 'aggressive chasing', 'fish hiding in corner'). "
    "Empty list if none.\n"
    "species_hints: visible species you can identify (common or scientific names). Empty list if unsure.\n"
    "confidence: your overall confidence (0.0-1.0)."
)


def _extract_json(text: str) -> dict:
    """Extract first JSON object from text, tolerating surrounding prose."""
    match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


class VLMAnalyzer:
    """Wraps Ollama vision API — one instance per pipeline."""

    def __init__(self, settings):
        self._s = settings
        # Latest received observation — read by SpeciesGuesser
        self.latest: VLMObservation | None = None

    async def analyze(self, jpeg_bytes: bytes, fish_names: list[str]) -> VLMObservation | None:
        """
        Send jpeg_bytes to Ollama and return a structured VLMObservation.
        Returns None on connection error or timeout (Ollama not running).
        """
        import httpx

        if not jpeg_bytes:
            return None

        b64_image = base64.b64encode(jpeg_bytes).decode("utf-8")
        fish_context = (
            f"\nKnown fish in this tank: {', '.join(fish_names)}."
            if fish_names else ""
        )

        payload = {
            "model": self._s.vlm_model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Analyze this aquarium image.{fish_context} Reply ONLY with the JSON object.",
                    "images": [b64_image],
                },
            ],
            "stream": False,
            "options": {"num_predict": self._s.vlm_max_tokens},
        }

        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                resp = await client.post(
                    f"{self._s.vlm_ollama_url}/api/chat",
                    json=payload,
                )
                resp.raise_for_status()
        except httpx.ConnectError:
            log.warning(
                "VLM: Ollama not reachable at %s — run `ollama serve` or check VLM_OLLAMA_URL",
                self._s.vlm_ollama_url,
            )
            return None
        except httpx.TimeoutException:
            log.warning("VLM: Ollama request timed out (model=%s)", self._s.vlm_model)
            return None
        except httpx.HTTPStatusError as exc:
            log.warning("VLM: Ollama returned HTTP %s", exc.response.status_code)
            return None

        raw = resp.json().get("message", {}).get("content", "")
        data = _extract_json(raw)

        obs = VLMObservation(
            fish_visible=int(data.get("fish_visible", 0)),
            anomalies=[str(a) for a in data.get("anomalies", []) if a],
            species_hints=[str(s) for s in data.get("species_hints", []) if s],
            confidence=float(data.get("confidence", 0.0)),
            raw_response=raw,
        )
        self.latest = obs
        return obs
