# Touch Grass server for Render: Ollama (CPU) + Hermes 3 3B + a small Node app.
# Build context is the repo root (see render.yaml), so the app can share js/plan.js
# and also serve the website.

# Ollama's official image is ~9 GB because of GPU libraries. Render has no GPUs,
# so copy only the binaries and the CPU libraries (~50 MB).
FROM ollama/ollama:0.35.1 AS ollama

FROM ubuntu:24.04
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates nodejs \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama/*.so* /usr/lib/ollama/llama-server /usr/lib/ollama/*LICENSE* /usr/lib/ollama/

ENV OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_KEEP_ALIVE=-1 \
    OLLAMA_NUM_PARALLEL=1 \
    OLLAMA_MAX_LOADED_MODELS=1

# Bake the model into the image so a deploy or restart never re-downloads it.
ARG OLLAMA_MODEL=hermes3:3b
ENV OLLAMA_MODEL=${OLLAMA_MODEL}
RUN if [ -n "$OLLAMA_MODEL" ]; then \
      ollama serve > /tmp/ollama.log 2>&1 & pid=$!; \
      for i in $(seq 1 30); do ollama list > /dev/null 2>&1 && break; sleep 1; done; \
      ollama pull "$OLLAMA_MODEL" || { cat /tmp/ollama.log; exit 1; }; \
      kill $pid; \
    fi

WORKDIR /app
COPY index.html sw.js manifest.webmanifest package.json ./
COPY css css
COPY js js
COPY icons icons
COPY server server

ENV PORT=10000
EXPOSE 10000
CMD ["sh", "/app/server/start.sh"]
