#!/bin/sh
# Regenerates the voice-message fixtures from their texts (macOS only: `say` with the
# Russian voice «Milena», WAV 16 kHz mono like the chat recorder). Invented content (Q20).
cd "$(dirname "$0")" || exit 1
for f in meeting-vector reminder-vector new-contact; do
  say -v Milena -o "$f.wav" --data-format=LEI16@16000 -f "$f.txt"
done
