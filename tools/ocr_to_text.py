#!/usr/bin/env python3
"""OCR a single rendered page image and emit lightly-cleaned text.

This is a helper used by build_ebook.sh. It takes a PNG page image, runs
Tesseract OCR on it, and applies conservative clean-up so the result reads
well in an EPUB without altering the underlying content:

* de-hyphenates words split across line breaks ("pro-\nduce" -> "produce")
* joins soft-wrapped lines inside a paragraph into a single line
* keeps blank lines (paragraph breaks) that Tesseract emits between blocks
* drops lines that contain nothing but a page number

The cleaned text is written to stdout.
"""
import re
import subprocess
import sys


def ocr(image_path: str) -> str:
    result = subprocess.run(
        ["tesseract", image_path, "stdout", "--psm", "1", "-l", "eng"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout


def clean(text: str) -> str:
    # Normalise newlines and split into paragraph blocks separated by blank lines.
    text = text.replace("\r\n", "\n").replace("\f", "\n\n")
    blocks = re.split(r"\n\s*\n", text)
    cleaned_blocks = []
    for block in blocks:
        lines = [ln.strip() for ln in block.split("\n")]
        lines = [ln for ln in lines if ln]
        if not lines:
            continue
        # Drop blocks that are only a bare page number.
        if len(lines) == 1 and re.fullmatch(r"[0-9]{1,4}", lines[0]):
            continue
        joined = ""
        for ln in lines:
            if not joined:
                joined = ln
            elif joined.endswith("-"):
                # de-hyphenate words broken across lines
                joined = joined[:-1] + ln
            else:
                joined = joined + " " + ln
        cleaned_blocks.append(joined)
    return "\n\n".join(cleaned_blocks)


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: ocr_to_text.py <image.png>\n")
        return 2
    sys.stdout.write(clean(ocr(sys.argv[1])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
