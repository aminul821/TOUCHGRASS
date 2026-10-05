import assert from "node:assert/strict";
import test from "node:test";
import { FAKE_LABELS, NATURE_LABELS, OUTDOOR_LABELS, checkPhoto, judge } from "../js/vision.js";

const spread = (labels, winner, p) =>
  labels.map((label) => ({ label, score: label === winner ? p : (1 - p) / (labels.length - 1) }));

test("an outdoor photo passes and lists what's in it", () => {
  const scene = spread([...OUTDOOR_LABELS, ...FAKE_LABELS], OUTDOOR_LABELS[1], 0.7);
  const nature = [{ label: "trees", score: 0.4 }, { label: "a bird", score: 0.3 }, { label: "snow", score: 0.01 }];
  const v = judge(scene, nature);
  assert.equal(v.outdoors, true);
  assert.deepEqual(v.spotted, ["trees", "bird"]);
});

test("screenshots and indoor photos fail", () => {
  for (const fake of FAKE_LABELS) {
    const v = judge(spread([...OUTDOOR_LABELS, ...FAKE_LABELS], fake, 0.8), []);
    assert.equal(v.outdoors, false, fake);
    assert.equal(v.top, fake);
  }
});

test("checkPhoto runs CLIP on both label sets", async () => {
  const calls = [];
  const importFn = async () => ({
    pipeline: async (task, model) => {
      assert.equal(task, "zero-shot-image-classification");
      assert.equal(model, "Xenova/clip-vit-base-patch32");
      return async (img, labels) => {
        calls.push(labels);
        return labels === NATURE_LABELS ? [{ label: "grass", score: 0.6 }] : spread(labels, OUTDOOR_LABELS[0], 0.9);
      };
    },
  });
  const v = await checkPhoto("data:image/jpeg;base64,xx", { importFn });
  assert.equal(calls.length, 2);
  assert.equal(v.outdoors, true);
  assert.deepEqual(v.spotted, ["grass"]);
});
