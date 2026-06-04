#!/usr/bin/env bash
#
# build_ebook.sh -- Convert the photographed "Theory of Horology" PDFs in this
# repository into a single reflowable EPUB ebook.
#
# The book is processed one chapter (one source PDF) at a time and the chapters
# are combined into the final EPUB at the very end. Each chapter's recognised
# text is cached as an HTML fragment under the build directory, so the run is
# resumable: if it is interrupted, re-running skips chapters that are already
# done and only processes what remains. This keeps a single troublesome
# chapter from forcing a full rebuild.
#
# Pipeline per chapter:
#   1. render every page to a PNG with pdftoppm
#   2. OCR each page with tools/ocr_to_text.py (Tesseract + light clean-up)
#   3. emit the recognised text as HTML paragraphs under a chapter heading
# Finally pandoc combines all chapter fragments into ToH.epub.
#
# Requirements: poppler-utils (pdftoppm), tesseract-ocr, python3, pandoc.
#
# Useful overrides (environment variables):
#   DPI=200          rendering resolution
#   JOBS=N           parallel OCR workers (defaults to nproc)
#   BUILD_DIR=path   where intermediate per-chapter HTML is cached
#   FORCE=1          rebuild chapters even if a cached fragment exists
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${REPO_DIR}/tools"
OUT_EPUB="${REPO_DIR}/ToH.epub"
BUILD_DIR="${BUILD_DIR:-${TMPDIR:-/tmp}/toh_build}"
CHAP_DIR="${BUILD_DIR}/chapters"
DPI="${DPI:-300}"
JOBS="${JOBS:-$(nproc)}"
FORCE="${FORCE:-0}"

mkdir -p "${CHAP_DIR}"

# Source PDFs paired with their chapter titles, in reading order.
# Format: "<file>::<title>"
ENTRIES=(
  "ToH Table of Contents.pdf::Table of Contents"
  "ToH ch 1-3.pdf::Chapters 1-3"
  "ToH ch 4&5.pdf::Chapters 4 & 5"
  "ToH ch 6.pdf::Chapter 6 - Escapements"
  "ToH ch 7.pdf::Chapter 7"
  "ToH ch 8.pdf::Chapter 8"
  "ToH ch 9.pdf::Chapter 9"
  "ToH ch 10.pdf::Chapter 10"
  "ToH ch 11.pdf::Chapter 11"
  "ToH ch 12.pdf::Chapter 12"
  "ToH ch 13.pdf::Chapter 13"
  "ToH ch 13.5 & 14full.pdf::Chapters 13.5 & 14"
  "TOH chap. 15.pdf::Chapter 15"
)

html_escape() {
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

# Convert cleaned plain text (blank-line separated blocks) into HTML <p>
# paragraphs. Reads stdin, writes stdout.
text_to_paragraphs() {
  awk 'BEGIN{RS="";FS="\n"} {print "<p>" $0 "</p>"}' | html_escape \
    | sed -e 's/&lt;p&gt;/<p>/g' -e 's/&lt;\/p&gt;/<\/p>/g'
}

# Build one chapter HTML fragment from a single PDF.
#   $1 = path to source PDF, $2 = chapter title, $3 = output fragment path
build_chapter() {
  local src="$1" title="$2" out="$3"
  local page_dir
  page_dir="$(mktemp -d)"
  trap 'rm -rf "${page_dir}"' RETURN

  # Render pages to PNGs. pdftoppm is single-threaded, so split the page
  # range into one chunk per worker and render the chunks concurrently; this
  # turns rendering (the slowest stage at high DPI) into a parallel job. The
  # fixed-width "-%03d" suffix keeps page files in natural sort order.
  local pages
  pages="$(pdfinfo "${src}" 2>/dev/null | awk '/^Pages:/{print $2}')"
  if [[ -z "${pages}" || "${pages}" -lt 1 ]]; then
    pdftoppm -png -r "${DPI}" "${src}" "${page_dir}/p" >/dev/null 2>&1
  else
    local chunk=$(( (pages + JOBS - 1) / JOBS ))
    local start
    for ((start = 1; start <= pages; start += chunk)); do
      local end=$(( start + chunk - 1 ))
      (( end > pages )) && end="${pages}"
      pdftoppm -png -r "${DPI}" -f "${start}" -l "${end}" \
        "${src}" "${page_dir}/p" >/dev/null 2>&1 &
    done
    wait
  fi

  # OCR every page in parallel into matching .txt files.
  find "${page_dir}" -name 'p*.png' -print0 \
    | xargs -0 -P "${JOBS}" -I{} bash -c \
        'python3 "$0" "$1" > "${1%.png}.txt"' "${TOOLS_DIR}/ocr_to_text.py" {}

  {
    echo "<h1>$(printf '%s' "${title}" | html_escape)</h1>"
    while IFS= read -r -d '' txt; do
      cat "${txt}"
      printf '\n\n'
    done < <(find "${page_dir}" -name 'p*.txt' -print0 | sort -z) \
      | text_to_paragraphs
  } > "${out}.tmp"
  mv "${out}.tmp" "${out}"
}

idx=0
for entry in "${ENTRIES[@]}"; do
  idx=$((idx + 1))
  pdf="${entry%%::*}"
  title="${entry##*::}"
  src="${REPO_DIR}/${pdf}"
  frag="$(printf '%s/%02d.html' "${CHAP_DIR}" "${idx}")"

  if [[ ! -f "${src}" ]]; then
    echo "WARNING: missing ${pdf}, skipping" >&2
    continue
  fi
  if [[ "${FORCE}" != "1" && -s "${frag}" ]]; then
    echo ">> [cached] ${pdf}" >&2
    continue
  fi
  echo ">> OCR ${pdf} -> ${title}" >&2
  build_chapter "${src}" "${title}" "${frag}"
  echo "   done ($(wc -w < "${frag}") words)" >&2
done

echo ">> combining chapters into EPUB" >&2
BODY="${BUILD_DIR}/body.html"
{
  echo '<?xml version="1.0" encoding="utf-8"?>'
  echo '<!DOCTYPE html>'
  echo '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/>'
  echo '<title>Theory of Horology</title></head><body>'
  for frag in "${CHAP_DIR}"/*.html; do
    [[ -s "${frag}" ]] && cat "${frag}"
  done
  echo '</body></html>'
} > "${BODY}"

pandoc "${BODY}" \
  --from=html \
  --to=epub3 \
  --metadata title="Theory of Horology" \
  --metadata language=en \
  --epub-chapter-level=1 \
  --toc --toc-depth=1 \
  -o "${OUT_EPUB}"

echo ">> wrote ${OUT_EPUB}" >&2
