#!/bin/sh
# Regenerates the DOCX and PDF of the meeting-notes fixture from its text (macOS only:
# `textutil`, `cupsfilter`). All names and companies are invented (docs/specs/ai-chat-tools Q20).
cd "$(dirname "$0")" || exit 1
textutil -convert docx -output meeting-notes.docx meeting-notes.txt
cupsfilter meeting-notes.txt > meeting-notes.pdf 2>/dev/null
