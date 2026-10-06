// "Did you really go outside?" A CLIP model (open weights) runs in the browser with
// transformers.js. The photo never leaves the phone, and once the model is cached this
// works on the trail with no signal.

import { TRANSFORMERS_URL, importLib } from "./libs.js";

export const CLIP_MODEL = "Xenova/clip-vit-base-patch32";

export const OUTDOOR_LABELS = [
  "a photo taken outdoors in nature",
  "a photo of a park with grass and trees",
  "a photo of the open sky outdoors",
  "a photo of a street or path outdoors",
  "a photo of a beach, river or lake",
];
export const FAKE_LABELS = [
  "a photo taken indoors in a room",
  "a screenshot of a phone or computer",
  "a photo of a computer screen or TV",
  "a photo of a printed picture or poster",
];
export const NATURE_LABELS = [
  "grass", "trees", "flowers", "leaves", "a bird", "a dog", "clouds", "a sunset",
  "water", "mountains", "sand", "snow", "a dirt trail", "moss", "rocks", "the moon",
];

const PASS = 0.6; // share of the probability that must go to an outdoor label

// Pure: turn CLIP scores into a verdict.
export function judge(sceneScores, natureScores) {
  const outdoor = sceneScores.filter((s) => OUTDOOR_LABELS.includes(s.label)).reduce((a, s) => a + s.score, 0);
  const top = [...sceneScores].sort((a, b) => b.score - a.score)[0];
  const spotted = [...natureScores]
    .sort((a, b) => b.score - a.score)
    .filter((s) => s.score >= 0.12)
    .slice(0, 3)
    .map((s) => s.label.replace(/^an? /, ""));
  return { outdoors: outdoor >= PASS, confidence: outdoor, top: top?.label || "", spotted };
}

let classifier = null;

export async function loadClip(onProgress, importFn = importLib) {
  if (classifier) return classifier;
  const { pipeline } = await importFn(TRANSFORMERS_URL);
  classifier = await pipeline("zero-shot-image-classification", CLIP_MODEL, {
    device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress" && onProgress) onProgress({ text: `Downloading ${p.file}`, progress: (p.progress || 0) / 100 });
    },
  });
  return classifier;
}

// imageUrl: an object URL or data URL of the photo.
export async function checkPhoto(imageUrl, { onProgress, importFn } = {}) {
  const clip = await loadClip(onProgress, importFn);
  const scene = await clip(imageUrl, [...OUTDOOR_LABELS, ...FAKE_LABELS]);
  const nature = await clip(imageUrl, NATURE_LABELS, { hypothesis_template: "a photo with {} in it" });
  return judge(scene, nature);
}
