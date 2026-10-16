"""Text to speech. The only input is the text of a reviewed template; no model writes what is spoken.

Provider interface plus one implementation: Gemini TTS (REST generateContent with audio output), chosen with
TTS_PROVIDER=gemini, or automatically when only a Google key is set. Gemini returns raw 16-bit PCM at 24 kHz or a
WAV file, depending on the model; ffmpeg encodes it to MP3. Audio is cached on disk by a hash of (provider, model, voice, locale, text).

Arabic uses the same multilingual model; the voice is picked with TTS_VOICE_AR / TTS_VOICE_EN. A native speaker
must listen to the Arabic before the video (the model cannot check its own pronunciation).
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import re
import shutil
import subprocess
import time
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx

from app.config import Settings

log = logging.getLogger("nodulebridge.tts")

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
PCM_RATE = 24000
ATTEMPTS = 3
BACKOFF_S = 2.0
RETRYABLE = {429, 500, 502, 503, 504}
MAX_WAIT_S = 65.0  # a per-minute limit says how long to wait; a per-day limit says hours, which we do not wait for
RETRY_HINT = re.compile(r"retry in (\d+(?:\.\d+)?)s")
MAX_TEXT_CHARS = 1500
PROVIDERS = ("gemini",)


class TtsUnavailable(Exception):
    """Speech is not configured or not possible on this machine. The message is safe to show."""


class TtsFailed(Exception):
    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.detail = detail


@dataclass
class Audio:
    data: bytes
    duration_s: float
    provider: str
    model: str
    voice: str
    locale: str
    text_sha256: str
    cached: bool = False


class TtsProvider(Protocol):
    def synthesize(self, text: str, locale: str) -> Audio: ...


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def resolve_tts_provider(settings: Settings) -> str | None:
    if settings.tts_provider:
        if settings.tts_provider.lower() not in PROVIDERS:
            raise TtsUnavailable(
                f"TTS_PROVIDER={settings.tts_provider!r} is not implemented. Use one of: {', '.join(PROVIDERS)}."
            )
        return settings.tts_provider.lower()
    return "gemini" if (settings.tts_api_key or settings.google_api_key) else None


def _is_wav(data: bytes, mime: str) -> bool:
    return mime.lower().startswith("audio/wav") or data[:4] == b"RIFF"


def _raw_rate(mime: str) -> int:
    m = re.search(r"rate=(\d+)", mime)
    return int(m.group(1)) if m else PCM_RATE


def audio_duration(data: bytes, mime: str) -> float:
    """Seconds of audio the speech model returned: a WAV file, or raw 16-bit mono PCM (audio/L16)."""
    if _is_wav(data, mime):
        with wave.open(io.BytesIO(data)) as w:
            return round(w.getnframes() / w.getframerate(), 2)
    return round(len(data) / (_raw_rate(mime) * 2), 2)


def to_mp3(data: bytes, mime: str, ffmpeg: str) -> bytes:
    """Encode the model audio as MP3. Which container comes back depends on the model (WAV or raw PCM)."""
    source = ["-f", "wav"] if _is_wav(data, mime) else ["-f", "s16le", "-ar", str(_raw_rate(mime)), "-ac", "1"]
    proc = subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", *source, "-i", "-", "-b:a", "64k", "-f", "mp3", "-"],
        input=data,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise TtsFailed("The audio could not be encoded.", proc.stderr.decode("utf-8", "replace")[:300])
    return proc.stdout


def find_ffmpeg(settings: Settings) -> str:
    path = settings.ffmpeg_path or shutil.which("ffmpeg")
    if not path:
        raise TtsUnavailable("Speech needs ffmpeg to make MP3 files. Install it or set FFMPEG_PATH.")
    return path


def _plain_error(status: int, message: str) -> str:
    if status in {401, 403}:
        return f"The Google API rejected the key ({status}): {message}"
    if status == 404:
        return f"The speech model was not found (404). Check TTS_MODEL: {message}"
    if status == 429:
        return f"The speech service is rate limiting requests (429): {message}"
    if status == 400:
        return f"The speech service rejected the request (400): {message}"
    return f"The speech service returned an error ({status}): {message}"


class GeminiTts:
    def __init__(
        self,
        settings: Settings,
        transport: httpx.BaseTransport | None = None,
        encoder: Callable[[bytes, str], bytes] | None = None,
    ):
        self.key = settings.tts_api_key or settings.google_api_key
        if not self.key:
            raise TtsUnavailable("Speech is not configured: set GOOGLE_API_KEY (or TTS_API_KEY) in the environment.")
        self.settings = settings
        self.model = settings.tts_model
        self.voices = {"ar": settings.tts_voice_ar or "Kore", "en": settings.tts_voice_en or "Kore"}
        self.cache_dir = settings.data_dir / "cache" / "tts"
        self._client = httpx.Client(transport=transport)
        self._encode = encoder or (lambda data, mime: to_mp3(data, mime, find_ffmpeg(settings)))

    def _key(self, text: str, locale: str) -> str:
        return text_sha256(f"gemini|{self.model}|{self.voices[locale]}|{locale}|{text}")

    def synthesize(self, text: str, locale: str) -> Audio:
        if locale not in self.voices:
            raise ValueError("locale must be 'en' or 'ar'")
        text = text.strip()
        if not text:
            raise TtsFailed("There is no text to speak.")
        if len(text) > MAX_TEXT_CHARS:
            raise TtsFailed("The text is too long to speak.", f"{len(text)} characters (limit {MAX_TEXT_CHARS}).")
        key = self._key(text, locale)
        mp3, meta = self.cache_dir / f"{key}.mp3", self.cache_dir / f"{key}.json"
        if mp3.exists() and meta.exists():
            m = json.loads(meta.read_text(encoding="utf-8"))
            return Audio(mp3.read_bytes(), m["duration_s"], "gemini", self.model, m["voice"], locale, text_sha256(text), cached=True)

        body = {
            "contents": [{"parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": self.voices[locale]}}},
            },
        }
        last = "The speech service did not return audio."
        for attempt in range(1, ATTEMPTS + 1):
            try:
                resp = self._client.post(
                    ENDPOINT.format(model=self.model),
                    headers={"x-goog-api-key": self.key, "content-type": "application/json"},
                    json=body,
                    timeout=90,
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = "The speech service did not answer in time." if isinstance(exc, httpx.TimeoutException) else "Could not reach the speech service."
                time.sleep(BACKOFF_S * 2 ** (attempt - 1))
                continue
            data = resp.json() if resp.content else {}
            if resp.status_code != 200:
                message = (data.get("error") or {}).get("message") or resp.text[:300]
                last = _plain_error(resp.status_code, message)
                if resp.status_code in RETRYABLE and attempt < ATTEMPTS:
                    hint = RETRY_HINT.search(message)
                    wait = float(hint.group(1)) + 1.0 if hint else BACKOFF_S * 2 ** (attempt - 1)
                    if wait <= MAX_WAIT_S:
                        time.sleep(wait)
                        continue
                raise TtsFailed("The voice summary could not be made.", last)
            try:
                inline = data["candidates"][0]["content"]["parts"][0]["inlineData"]
                pcm = base64.b64decode(inline["data"])
                mime = inline.get("mimeType", "audio/L16;rate=24000")
            except (KeyError, IndexError, ValueError):
                last = "The speech service answered without audio."
                continue
            if not pcm:
                last = "The speech service returned empty audio."
                continue
            audio = self._encode(pcm, mime)
            duration = audio_duration(pcm, mime)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            mp3.write_bytes(audio)
            meta.write_text(
                json.dumps({"voice": self.voices[locale], "model": self.model, "locale": locale, "duration_s": duration, "text_sha256": text_sha256(text)}, indent=2),
                encoding="utf-8",
            )
            return Audio(audio, duration, "gemini", self.model, self.voices[locale], locale, text_sha256(text))
        raise TtsFailed("The voice summary could not be made.", last)


def make_tts(settings: Settings) -> TtsProvider:
    provider = resolve_tts_provider(settings)
    if provider == "gemini":
        return GeminiTts(settings)
    raise TtsUnavailable("Speech is not configured: set TTS_PROVIDER=gemini and GOOGLE_API_KEY (or TTS_API_KEY).")


def write_audio(path: Path, audio: Audio, text: str, review_status: str) -> None:
    """Save a pre-generated voice file and its sidecar (the text it speaks, so the UI can check it still matches)."""
    path.write_bytes(audio.data)
    path.with_suffix(".json").write_text(
        json.dumps(
            {
                "locale": audio.locale,
                "text": text,
                "text_sha256": audio.text_sha256,
                "provider": audio.provider,
                "model": audio.model,
                "voice": audio.voice,
                "duration_s": audio.duration_s,
                "review_status": review_status,
                "generated_by": "AI voice (Gemini TTS)",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
