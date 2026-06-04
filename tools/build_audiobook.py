#!/usr/bin/env python3
"""build_audiobook.py -- export the book's OCR text layer to audio files.

The web viewer already reads pages aloud in the browser (Web Speech API). This
script is the *offline* complement: it turns the OCR text captured in
``web/book.json`` into one audio file per chapter plus an ``.m3u`` playlist, so
the result can be loaded into any podcast/audiobook player.

It shells out to whatever offline text-to-speech engine is installed, trying in
order: ``espeak-ng``, ``espeak``, then ``pico2wave``. If an ``ffmpeg``/``lame``
encoder is available the per-chapter WAVs are additionally encoded to MP3.

Run ``tools/build_webbook.py`` first so ``web/book.json`` exists.

Useful environment overrides:
    OUT_DIR=audiobook   where audio files are written
    ENGINE=espeak-ng    force a specific TTS engine
    VOICE=en            engine voice/language
    WPM=160             speaking rate (words per minute, espeak engines)
    ONLY="4,8"          export only these 1-based chapter indices
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
MANIFEST = REPO_DIR / "web" / "book.json"
OUT_DIR = REPO_DIR / os.environ.get("OUT_DIR", "audiobook")
VOICE = os.environ.get("VOICE", "en")
WPM = os.environ.get("WPM", "160")


def detect_engine() -> str:
    forced = os.environ.get("ENGINE")
    if forced:
        if not shutil.which(forced):
            sys.exit(f"requested ENGINE={forced!r} is not installed")
        return forced
    for name in ("espeak-ng", "espeak", "pico2wave"):
        if shutil.which(name):
            return name
    sys.exit(
        "No text-to-speech engine found. Install one, e.g.:\n"
        "  sudo apt-get install -y espeak-ng\n"
        "  # or: sudo apt-get install -y libttspico-utils"
    )


def synthesize(engine: str, text: str, wav_path: Path) -> None:
    """Render ``text`` to ``wav_path`` using the chosen engine."""
    if engine in ("espeak-ng", "espeak"):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
            fh.write(text)
            txt_path = fh.name
        try:
            subprocess.run(
                [engine, "-v", VOICE, "-s", str(WPM), "-w", str(wav_path), "-f", txt_path],
                check=True, capture_output=True,
            )
        finally:
            os.unlink(txt_path)
    elif engine == "pico2wave":
        # pico2wave takes text as an argument and is happiest with short input,
        # so synthesise sentence-sized chunks and concatenate the WAVs.
        chunks = _chunk(text, 800)
        parts = []
        try:
            for i, chunk in enumerate(chunks):
                part = wav_path.with_suffix(f".part{i}.wav")
                subprocess.run(
                    ["pico2wave", "-l", VOICE, "-w", str(part), chunk],
                    check=True, capture_output=True,
                )
                parts.append(part)
            _concat_wavs(parts, wav_path)
        finally:
            for part in parts:
                part.unlink(missing_ok=True)
    else:  # pragma: no cover - guarded by detect_engine
        raise ValueError(f"unsupported engine {engine!r}")


def _chunk(text: str, size: int):
    sentences = re.split(r"(?<=[.!?])\s+", text)
    buf = ""
    for s in sentences:
        if len(buf) + len(s) + 1 > size and buf:
            yield buf
            buf = ""
        buf = f"{buf} {s}".strip()
    if buf:
        yield buf


def _concat_wavs(parts, dst: Path) -> None:
    """Concatenate WAV files using only the standard library."""
    import wave

    if not parts:
        return
    with wave.open(str(parts[0]), "rb") as first:
        params = first.getparams()
    with wave.open(str(dst), "wb") as out:
        out.setparams(params)
        for part in parts:
            with wave.open(str(part), "rb") as w:
                out.writeframes(w.readframes(w.getnframes()))


def maybe_encode_mp3(wav_path: Path) -> Path:
    """Encode WAV to MP3 if an encoder exists; otherwise keep the WAV."""
    mp3_path = wav_path.with_suffix(".mp3")
    if shutil.which("ffmpeg"):
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path), "-codec:a", "libmp3lame",
             "-qscale:a", "4", str(mp3_path)],
            check=True, capture_output=True,
        )
    elif shutil.which("lame"):
        subprocess.run(["lame", "--quiet", str(wav_path), str(mp3_path)],
                       check=True, capture_output=True)
    else:
        return wav_path
    wav_path.unlink(missing_ok=True)
    return mp3_path


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "chapter"


def main() -> int:
    if not MANIFEST.exists():
        sys.exit(f"{MANIFEST} not found; run tools/build_webbook.py first")
    book = json.loads(MANIFEST.read_text(encoding="utf-8"))
    chapters = book.get("chapters", [])
    pages = book.get("pages", [])
    if not chapters or not pages:
        sys.exit("book.json has no chapters/pages to narrate")

    only = os.environ.get("ONLY", "").strip()
    selected = {int(x) for x in re.split(r"[ ,]+", only) if x} if only else None

    engine = detect_engine()
    print(f">> using TTS engine: {engine}", file=sys.stderr)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    playlist = []
    for ch_idx, ch in enumerate(chapters, start=1):
        if selected is not None and ch_idx not in selected:
            continue
        text = "\n\n".join(
            p.get("text", "") for p in pages if p.get("chapter") == ch_idx - 1
        ).strip()
        title = ch.get("title", f"Chapter {ch_idx}")
        if not text:
            print(f"   skip {title} (no text)", file=sys.stderr)
            continue
        wav = OUT_DIR / f"{ch_idx:02d}-{slug(title)}.wav"
        print(f">> narrating {title} -> {wav.name}", file=sys.stderr)
        synthesize(engine, f"{title}.\n\n{text}", wav)
        out = maybe_encode_mp3(wav)
        playlist.append((title, out.name))

    if not playlist:
        print("Nothing was narrated.", file=sys.stderr)
        return 1

    m3u = OUT_DIR / "ToH.m3u"
    with m3u.open("w", encoding="utf-8") as fh:
        fh.write("#EXTM3U\n")
        for title, name in playlist:
            fh.write(f"#EXTINF:-1,{title}\n{name}\n")
    try:
        where = m3u.relative_to(REPO_DIR)
    except ValueError:
        where = m3u
    print(f">> wrote {len(playlist)} tracks and {where}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
