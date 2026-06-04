# Theory of Horology — Online Flip-Book

This repository holds photographed/scanned PDFs of the *Theory of Horology*
watchmaking textbook (13 source PDFs, 375 pages) together with tooling that
turns them into a polished **online flip-book** — and, optionally, an
**audiobook**.

The pages were photographed rather well, so the flip-book keeps the *page
itself* as the thing you read: every diagram, colour header and hand-drawn
illustration survives untouched. OCR text is still produced, but only as a
hidden layer that powers full-text search and "read aloud" narration — it is
never shown in place of the scans.

> The earlier OCR-only EPUB (`ToH.epub`, built by `tools/build_ebook.sh`) is
> still available as a lightweight, reflowable companion, but it discards the
> illustrations. The flip-book is the recommended way to read the book.

## Contents

| Path | Description |
| --- | --- |
| `ToH *.pdf`, `TOH *.pdf` | Original photographed source pages (one PDF per chapter group). |
| `web/` | The static flip-book web app (open `web/index.html`). |
| `web/book.json` | Manifest the viewer reads: chapters + per-page image/thumbnail/text. |
| `web/pages/` | Web-optimised page images + thumbnails (a Table of Contents + Chapter 6 sample is committed; run the build to populate the rest). |
| `tools/build_webbook.py` | Renders the PDFs into `web/pages/` + `web/book.json`. |
| `tools/build_audiobook.py` | Exports the OCR text layer to per-chapter audio + a playlist. |
| `tools/build_ebook.sh` | Legacy OCR-only EPUB pipeline. |
| `tools/ocr_to_text.py` | Per-page OCR + text clean-up helper shared by the builds. |
| `ToH.epub` | Legacy reflowable ebook. |

## The flip-book

Open `web/index.html` through a local web server (browsers block `fetch` of
`book.json` from `file://`):

```sh
cd web
python3 -m http.server
# then visit http://localhost:8000/
```

Features:

* **Real page-flipping** two-page spread (single page on narrow screens), with
  arrow-key / click navigation and a page slider.
* **Contents** menu and a **thumbnail** grid for jumping around.
* **Click to zoom** any page to full resolution.
* **Full-text search** across the OCR layer, with highlighted snippets that
  jump to the page.
* **Read aloud / audiobook mode** — narrates the current spread with the
  browser's speech synthesis and auto-advances the pages. No server or
  pre-rendered audio required.

The app is dependency-free (vanilla HTML/CSS/JS), so the `web/` folder can be
served as-is or published with GitHub Pages.

## Building the flip-book data

`tools/build_webbook.py` renders each source PDF one chapter at a time:

1. **Render** — every page is rasterised to a web-optimised JPEG (plus a small
   thumbnail) with `pdftoppm`, scaled to a sensible width.
2. **OCR** — each page image is recognised with Tesseract and lightly cleaned
   (`tools/ocr_to_text.py`: de-hyphenation, soft-wrap joining, page-number
   stripping) into a hidden text layer.
3. **Manifest** — image paths, thumbnails and text are written to
   `web/book.json`.

The run is **resumable**: a page whose image, thumbnail and text already exist
is skipped, and `book.json` is rebuilt from whatever pages are present, so
partial builds still produce a working book.

```sh
./tools/build_webbook.py            # build every chapter
ONLY="4,8" ./tools/build_webbook.py # only chapters 4 and 8 (1-based)
```

Useful environment overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WIDTH` | `1240` | Full-page image width in px. |
| `THUMB_WIDTH` | `240` | Thumbnail width in px. |
| `QUALITY` | `78` | JPEG quality for full pages. |
| `JOBS` | `nproc` | Parallel render/OCR workers. |
| `ONLY` | *(all)* | Comma-separated 1-based chapter indices to build. |
| `FORCE` | `0` | Set to `1` to re-render/re-OCR even if outputs exist. |

## Building an audiobook (offline export)

The flip-book already reads aloud in the browser. For a portable audiobook,
`tools/build_audiobook.py` narrates the OCR text layer to one audio file per
chapter plus an `.m3u` playlist, using whatever offline TTS engine is installed
(`espeak-ng`, `espeak`, or `pico2wave`; MP3 encoding is used when `ffmpeg`/
`lame` is present):

```sh
./tools/build_audiobook.py             # all chapters -> audiobook/
ONLY="6" ./tools/build_audiobook.py    # just Chapter 6
```

Output lands in `audiobook/` (git-ignored). Run `tools/build_webbook.py` first
so `web/book.json` exists.

## Requirements

* [`poppler-utils`](https://poppler.freedesktop.org/) — provides `pdftoppm` and `pdfinfo`
* [`tesseract-ocr`](https://github.com/tesseract-ocr/tesseract) — OCR engine (English language data)
* `python3`
* For the optional audiobook export: [`espeak-ng`](https://github.com/espeak-ng/espeak-ng) (or `espeak`/`libttspico-utils`), and optionally `ffmpeg`/`lame` for MP3
* For the legacy EPUB only: [`pandoc`](https://pandoc.org/)

On Debian/Ubuntu:

```sh
sudo apt-get install -y poppler-utils tesseract-ocr espeak-ng
# optional extras: pandoc ffmpeg
```

## Notes

The OCR text is produced automatically and may contain recognition errors,
especially on heavily illustrated pages. In the flip-book this no longer hurts
the reading experience — you are looking at the original photograph — and the
imperfect text simply powers search and narration.
