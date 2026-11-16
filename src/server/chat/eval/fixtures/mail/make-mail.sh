#!/bin/sh
# Regenerates the PDF of the mail with a prompt injection (macOS only: `cupsfilter`). Invented content.
cd "$(dirname "$0")" && cupsfilter mail-injection.txt > mail-injection.pdf 2>/dev/null
