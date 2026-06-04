# Theory of Horology — Ebook

This repository holds photographed/scanned PDFs of the *Theory of Horology*
watchmaking textbook (13 source PDFs, 375 pages) together with tooling that
converts them into a single reflowable **EPUB** ebook, [`ToH.epub`](ToH.epub).

## Contents

| Path | Description |
| --- | --- |
| `ToH *.pdf`, `TOH *.pdf` | Original photographed source pages (one PDF per chapter group). |
| `ToH.epub` | Generated ebook (Table of Contents + Chapters 1–15). |
| `tools/build_ebook.sh` | End-to-end build pipeline. |
| `tools/ocr_to_text.py` | Per-page OCR + text clean-up helper used by the build. |

## How the ebook is built

`tools/build_ebook.sh` runs one chapter (one source PDF) at a time and combines
the results into the final EPUB:

1. **Render** — each page is rasterised to a PNG with `pdftoppm` at 300 DPI.
   Rendering is split into per-core chunks and run in parallel (it is the
   slowest stage at high DPI).
2. **OCR** — every page image is recognised with Tesseract (`--oem 1 --psm 3`,
   English). `tools/ocr_to_text.py` then applies conservative clean-up:
   de-hyphenating words split across lines, joining soft-wrapped lines into
   paragraphs, and dropping bare page-number lines. Each Tesseract process is
   pinned to a single thread (`OMP_THREAD_LIMIT=1`) so the parallel page jobs
   do not oversubscribe the CPU.
3. **Assemble** — the recognised text becomes HTML paragraphs under a chapter
   heading, and `pandoc` combines all chapters into `ToH.epub` with a table of
   contents.

Each chapter's HTML is cached under the build directory, so the run is
**resumable**: re-running skips chapters that are already done and only
processes what remains.

## Requirements

* [`poppler-utils`](https://poppler.freedesktop.org/) — provides `pdftoppm` and `pdfinfo`
* [`tesseract-ocr`](https://github.com/tesseract-ocr/tesseract) — OCR engine (English language data)
* `python3`
* [`pandoc`](https://pandoc.org/) — EPUB assembly

On Debian/Ubuntu:

```sh
sudo apt-get install -y poppler-utils tesseract-ocr pandoc
```

## Usage

From the repository root:

```sh
./tools/build_ebook.sh
```

This writes `ToH.epub` in the repository root. Useful environment overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DPI` | `300` | Rendering resolution. Lower (e.g. `200`) is faster with slightly lower OCR fidelity. |
| `JOBS` | `nproc` | Number of parallel render/OCR workers. |
| `BUILD_DIR` | `$TMPDIR/toh_build` | Where intermediate per-chapter HTML is cached. |
| `FORCE` | `0` | Set to `1` to rebuild chapters even if a cached fragment exists. |

Example — a faster lower-resolution rebuild:

```sh
DPI=200 FORCE=1 ./tools/build_ebook.sh
```

## Notes

The OCR text is produced automatically and may contain recognition errors,
especially on heavily illustrated pages; the EPUB is intended as a searchable,
reflowable companion to the original scans rather than a proofread edition.
