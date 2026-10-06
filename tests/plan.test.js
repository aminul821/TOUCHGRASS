import assert from "node:assert/strict";
import test from "node:test";
import * as o from "../js/outdoors.js";
import { MODELS, WASM_MODEL, buildFacts, resolveModel, splitMission, stripThinking, templatePlan, writePlan } from "../js/plan.js";
import { fakeFetch } from "./fixtures.js";

const place = { name: "Dhaka", label: "Dhaka, Bangladesh", lat: 23.81, lon: 90.41 };

async function facts() {
  const f = fakeFetch();
  return buildFacts(place, await o.forecast(1, 2, f), await o.nearbySpots(23.81, 90.41, { fetchFn: f }));
}

test("facts carry only real places", async () => {
  const fx = await facts();
  assert.deepEqual(fx.nearby_spots.map((s) => s.name), ["Botanical Garden", "Ramna Park", "Viewpoint"]);
  assert.equal(fx.plan_for, "today");
  assert.equal(fx.best_window.length, 2);
});

test("mission is split out of the model's text", () => {
  assert.deepEqual(splitMission("Go to the park at 4.\nMission: spot a heron."), { plan: "Go to the park at 4.", mission: "spot a heron." });
  assert.deepEqual(splitMission("Go now. MISSION - count clouds"), { plan: "Go now.", mission: "count clouds" });
  assert.deepEqual(splitMission("No mission line here"), { plan: "No mission line here", mission: "" });
});

test("template plan names the closest spot", async () => {
  const { plan, mission } = splitMission(templatePlan(await facts()));
  assert.match(plan, /Botanical Garden \(\d+ min walk\)/);
  assert.match(mission, /leaves/);
});

test("Ollama backend sends the facts and reads the reply", async () => {
  let sent;
  const fetchFn = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ message: { content: "Walk to Botanical Garden at 15:00.\nMission: find a red leaf." } }) };
  };
  const r = await writePlan(await facts(), { ai: "ollama", ollamaUrl: "http://localhost:11434/", ollamaModel: "gemma3:4b" }, { fetchFn });
  assert.equal(sent.url, "http://localhost:11434/api/chat");
  assert.match(sent.body.messages[1].content, /Botanical Garden/);
  assert.equal(r.mission, "find a red leaf.");
  assert.match(r.source, /gemma3:4b · on your device/);
});

test("with WebGPU the chosen WebLLM model runs", async () => {
  let loaded;
  const importFn = async (url) => {
    assert.match(url, /web-llm@[\d.]+\/lib\/index\.js$/);
    return {
      CreateMLCEngine: async (id) => {
        loaded = id;
        return { chat: { completions: { create: async () => ({ choices: [{ message: { content: "Go.\nMission: hug a tree." } }] }) } } };
      },
    };
  };
  const r = await writePlan(await facts(), { ai: "local", model: "Llama-3.2-1B-Instruct-q4f16_1-MLC" }, { importFn, gpu: true });
  assert.equal(loaded, "Llama-3.2-1B-Instruct-q4f16_1-MLC");
  assert.equal(r.mission, "hug a tree.");
  assert.equal(r.source, "Llama 3.2 1B · on your device");
});

test("without WebGPU it runs the WebAssembly model and drops any <think> text", async () => {
  let opts;
  let genArgs;
  const importFn = async (url) => {
    assert.match(url, /transformers@[\d.]+\/dist\/transformers\.min\.js$/);
    return {
      pipeline: async (task, id, o) => {
        assert.equal(task, "text-generation");
        assert.equal(id, WASM_MODEL.id);
        opts = o;
        return async (msgs, args) => {
          genArgs = args;
          return [{ generated_text: [...msgs, { role: "assistant", content: "<think>hmm</think>\nWalk to Ramna Park.\nMission: spot a kite." }] }];
        };
      },
    };
  };
  const r = await writePlan(await facts(), { ai: "local", model: MODELS[0].id }, { importFn, gpu: false });
  assert.equal(opts.device, "wasm");
  assert.equal(genArgs.tokenizer_encode_kwargs.enable_thinking, false);
  assert.deepEqual([r.plan, r.mission], ["Walk to Ramna Park.", "spot a kite."]);
  assert.equal(r.source, "Qwen 3 0.6B · on your device");
});

test("resolveModel and stripThinking", () => {
  assert.equal(resolveModel(MODELS[1].id, true), MODELS[1]);
  assert.equal(resolveModel(MODELS[1].id, false), WASM_MODEL);
  assert.equal(resolveModel("nope", true), MODELS[0]);
  assert.equal(stripThinking("<think>unfinished"), "");
});

test("an empty reply or 'none' gives the template", async () => {
  const importFn = async () => ({ CreateMLCEngine: async () => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: "  " } }] }) } } }) });
  const r = await writePlan(await facts(), { ai: "local", model: MODELS[2].id }, { importFn, gpu: true });
  assert.equal(r.source, "template");
  assert.equal((await writePlan(await facts(), { ai: "none" })).source, "template");
});

test("a failing AI falls back to the template instead of breaking", async () => {
  const fetchFn = async () => ({ ok: false, status: 403 });
  const r = await writePlan(await facts(), { ai: "ollama", ollamaUrl: "http://x", ollamaModel: "m" }, { fetchFn });
  assert.equal(r.source, "template");
  assert.match(r.error, /403/);
  assert.match(r.plan, /Botanical Garden/);
});
