#!/usr/bin/env bash
#
# build_ebook.sh -- Convert the photographed "Theory of Horology" PDFs in this
# repository into a single reflowable EPUB ebook.
#
# Pipeline per source PDF (processed in reading order):
#   1. render every page to a PNG with pdftoppm (300 DPI)
#   2. OCR each page with tools/ocr_to_text.py (Tesseract + light clean-up)
#   3. emit the recognised text as HTML paragraphs under a chapter heading
# Finally pandoc assembles all chapters into ToH.epub.
#
# Requirements: poppler-utils (pdftoppm), tesseract-ocr, python3, pandoc.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${REPO_DIR}/tools"
OUT_EPUB="${REPO_DIR}/ToH.epub"
WORK_DIR="$(mktemp -d)"
DPI="${DPI:-300}"
JOBS="${JOBS:-$(nproc)}"

trap 'rm -rf "${WORK_DIR}"' EXIT

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

# Convert a cleaned plain-text file into HTML <p> paragraphs (blank-line
# separated blocks become paragraphs). Reads stdin, writes stdout.
text_to_paragraphs() {
  awk 'BEGIN{RS="";FS="\n"} {print "<p>" $0 "</p>"}' | html_escape \
    | sed -e 's/&lt;p&gt;/<p>/g' -e 's/&lt;\/p&gt;/<\/p>/g'
}

BODY="${WORK_DIR}/body.html"
{
  echo '<?xml version="1.0" encoding="utf-8"?>'
  echo '<!DOCTYPE html>'
  echo '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/>'
  echo '<title>Theory of Horology</title></head><body>'
} > "${BODY}"

for entry in "${ENTRIES[@]}"; do
  pdf="${entry%%::*}"
  title="${entry##*::}"
  src="${REPO_DIR}/${pdf}"
  if [[ ! -f "${src}" ]]; then
    echo "WARNING: missing ${pdf}, skipping" >&2
    continue
  fi
  echo ">> ${pdf} -> ${title}" >&2

  page_dir="${WORK_DIR}/pages"
  rm -rf "${page_dir}"; mkdir -p "${page_dir}"
  pdftoppm -png -r "${DPI}" "${src}" "${page_dir}/p" >/dev/null 2>&1

  # OCR every page in parallel into matching .txt files.
  find "${page_dir}" -name 'p*.png' -print0 \
    | xargs -0 -P "${JOBS}" -I{} bash -c \
        'python3 "$0" "$1" > "${1%.png}.txt"' "${TOOLS_DIR}/ocr_to_text.py" {}

  {
    echo "<h1>$(printf '%s' "${title}" | html_escape)</h1>"
    # Concatenate page texts in natural page order.
    while IFS= read -r -d '' txt; do
      cat "${txt}"
      printf '\n\n'
    done < <(find "${page_dir}" -name 'p*.txt' -print0 | sort -z) \
      | text_to_paragraphs
  } >> "${BODY}"
done

echo '</body></html>' >> "${BODY}"

echo ">> assembling EPUB with pandoc" >&2
pandoc "${BODY}" \
  --from=html \
  --to=epub3 \
  --metadata title="Theory of Horology" \
  --metadata language=en \
  --epub-chapter-level=1 \
  --toc --toc-depth=1 \
  -o "${OUT_EPUB}"

echo ">> wrote ${OUT_EPUB}" >&2
