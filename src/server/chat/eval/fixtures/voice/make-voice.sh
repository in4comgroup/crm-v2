#!/bin/sh
# Regenerates the voice-message fixture from its text (macOS only: `say` with the
# Russian voice «Milena», WAV 16 kHz mono like the chat recorder). Invented content (Q20).
cd "$(dirname "$0")" && say -v Milena -o meeting-vector.wav --data-format=LEI16@16000 -f meeting-vector.txt
