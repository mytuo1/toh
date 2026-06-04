#!/usr/bin/env python3
"""build_webbook.py -- turn the photographed "Theory of Horology" PDFs into the
data for an online flip-book.

Unlike the EPUB pipeline (which throws the scans away and keeps only OCR text),
this keeps the *photographed page itself* as the thing you read -- so every
diagram, colour header and hand-drawn illustration survives untouched. OCR is
still run, but only as a hidden text layer used for full-text search and the
"read aloud" audiobook mode in the web viewer.

For each source PDF it produces, under ``web/``::

    web/pages/chNN/pPPP.jpg   web-optimised full page image
    web/pages/chNN/tPPP.jpg   small thumbnail
    web/book.json             manifest: chapters + per-page image/thumb/text

The run is resumable: a page whose image, thumbnail and OCR sidecar already
exist is skipped unless ``FORCE=1``. ``book.json`` is rewritten from whatever
pages currently exist on disk, so partial builds still yield a working book.

Requirements: poppler-utils (pdftoppm, pdfinfo), tesseract-ocr, python3.

Useful environment overrides:
    WIDTH=1240      full-page image width in px
    THUMB_WIDTH=240 thumbnail width in px
    QUALITY=78      JPEG quality for full pages
    JOBS=N          parallel render/OCR workers (defaults to nproc)
    ONLY="6,10"     build only these 1-based chapter indices (comma separated)
    FORCE=1         re-render/re-OCR pages even if outputs already exist
"""
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Reuse the OCR + clean-up helpers from the existing per-page helper.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ocr_to_text import clean, ocr  # noqa: E402

REPO_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_DIR / "web"
PAGES_DIR = WEB_DIR / "pages"
MANIFEST = WEB_DIR / "book.json"

WIDTH = int(os.environ.get("WIDTH", "1240"))
THUMB_WIDTH = int(os.environ.get("THUMB_WIDTH", "240"))
QUALITY = int(os.environ.get("QUALITY", "78"))
JOBS = int(os.environ.get("JOBS", str(os.cpu_count() or 4)))
FORCE = os.environ.get("FORCE", "0") == "1"

# Source PDFs paired with their chapter titles, in reading order.
ENTRIES = [
    ("ToH Table of Contents.pdf", "Table of Contents"),
    ("ToH ch 1-3.pdf", "Chapters 1-3"),
    ("ToH ch 4&5.pdf", "Chapters 4 & 5"),
    ("ToH ch 6.pdf", "Chapter 6 - Escapements"),
    ("ToH ch 7.pdf", "Chapter 7"),
    ("ToH ch 8.pdf", "Chapter 8"),
    ("ToH ch 9.pdf", "Chapter 9"),
    ("ToH ch 10.pdf", "Chapter 10"),
    ("ToH ch 11.pdf", "Chapter 11"),
    ("ToH ch 12.pdf", "Chapter 12"),
    ("ToH ch 13.pdf", "Chapter 13"),
    ("ToH ch 13.5 & 14full.pdf", "Chapters 13.5 & 14"),
    ("TOH chap. 15.pdf", "Chapter 15"),
]


def pdf_page_count(src: Path) -> int:
    try:
        out = subprocess.run(
            ["pdfinfo", str(src)], capture_output=True, text=True, check=True
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return 0
    m = re.search(r"^Pages:\s+(\d+)", out, re.MULTILINE)
    return int(m.group(1)) if m else 0


def render_page(src: Path, page: int, dst: Path, width: int, quality: int) -> None:
    """Render a single PDF page to a width-scaled JPEG at ``dst``."""
    with tempfile.TemporaryDirectory() as tmp:
        prefix = Path(tmp) / "p"
        subprocess.run(
            [
                "pdftoppm", "-jpeg", "-jpegopt", f"quality={quality}",
                "-scale-to-x", str(width), "-scale-to-y", "-1",
                "-f", str(page), "-l", str(page), str(src), str(prefix),
            ],
            check=True, capture_output=True,
        )
        produced = sorted(Path(tmp).glob("p*.jpg"))
        if not produced:
            raise RuntimeError(f"pdftoppm produced no image for {src} page {page}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.replace(produced[0], dst)


def build_page(src: Path, ch_idx: int, page: int) -> dict:
    """Render image + thumbnail and OCR one page; return its manifest entry."""
    ch_dir = PAGES_DIR / f"ch{ch_idx:02d}"
    img = ch_dir / f"p{page:03d}.jpg"
    thumb = ch_dir / f"t{page:03d}.jpg"
    txt = ch_dir / f"p{page:03d}.txt"

    if FORCE or not img.exists():
        render_page(src, page, img, WIDTH, QUALITY)
    if FORCE or not thumb.exists():
        render_page(src, page, thumb, THUMB_WIDTH, 70)
    if FORCE or not txt.exists():
        txt.write_text(clean(ocr(str(img))), encoding="utf-8")

    return {
        "img": img.relative_to(WEB_DIR).as_posix(),
        "thumb": thumb.relative_to(WEB_DIR).as_posix(),
        "text": txt.read_text(encoding="utf-8"),
    }


def main() -> int:
    only = os.environ.get("ONLY", "").strip()
    selected = {int(x) for x in re.split(r"[ ,]+", only) if x} if only else None

    chapters = []
    pages = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=JOBS) as pool:
        for idx, (pdf, title) in enumerate(ENTRIES, start=1):
            if selected is not None and idx not in selected:
                continue
            src = REPO_DIR / pdf
            if not src.exists():
                print(f"WARNING: missing {pdf}, skipping", file=sys.stderr)
                continue
            n = pdf_page_count(src)
            if n < 1:
                print(f"WARNING: no pages in {pdf}, skipping", file=sys.stderr)
                continue
            print(f">> chapter {idx:02d} {pdf} ({n} pages)", file=sys.stderr)

            start = len(pages)
            results = list(
                pool.map(lambda p: build_page(src, idx, p), range(1, n + 1))
            )
            for page_no, entry in enumerate(results, start=1):
                entry.update(chapter=len(chapters), n=page_no)
                pages.append(entry)
            chapters.append(
                {"title": title, "start": start, "pageCount": len(results)}
            )
            print(f"   done ({len(results)} pages)", file=sys.stderr)

    if not pages:
        print("No pages were built; nothing to write.", file=sys.stderr)
        return 1

    WEB_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(
        json.dumps(
            {
                "title": "Theory of Horology",
                "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "chapters": chapters,
                "pages": pages,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(
        f">> wrote {MANIFEST.relative_to(REPO_DIR)} "
        f"({len(chapters)} chapters, {len(pages)} pages)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
