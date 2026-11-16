#!/bin/sh
# Regenerates the DOCX of the meeting-notes fixture from its text (macOS only: `textutil`).
# All names and companies are invented (docs/specs/ai-chat-tools Q20).
cd "$(dirname "$0")" && textutil -convert docx -output meeting-notes.docx meeting-notes.txt
