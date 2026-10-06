#!/bin/sh
# Ollama (private, 127.0.0.1) in the background, the web app in front.
ollama serve &
exec node /app/server/index.mjs
