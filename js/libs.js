// Pinned, self-contained ES module builds of the in-browser AI libraries.
// (Exact files, not CDN-transformed bundles, so what we test is what ships.)
export const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";
export const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js";

const loaded = {};
export const importLib = (url) => (loaded[url] ??= import(url));

// WebGPU is "available" only if the browser exposes it AND gives us a GPU adapter.
let gpuCheck;
export function hasWebGPU() {
  gpuCheck ??= (async () => {
    try {
      return Boolean(navigator.gpu && (await navigator.gpu.requestAdapter()));
    } catch {
      return false;
    }
  })();
  return gpuCheck;
}

// The Touch Grass server on Render (Hermes 3 on Ollama). When the site itself is served
// from Render, use the same origin. Change it in ⚙️ AI settings if your URL differs.
export const DEFAULT_SERVER_URL =
  typeof location !== "undefined" && location.hostname.endsWith(".onrender.com")
    ? location.origin
    : "https://touchgrass-agent.onrender.com";
