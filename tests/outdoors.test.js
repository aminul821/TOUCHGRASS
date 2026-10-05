import assert from "node:assert/strict";
import test from "node:test";
import * as o from "../js/outdoors.js";
import { fakeFetch } from "./fixtures.js";

test("geocode builds a readable label", async () => {
  const p = await o.geocode("dhaka", fakeFetch());
  assert.equal(p.label, "Dhaka, Dhaka Division, Bangladesh");
});

test("geocode explains a miss", async () => {
  const miss = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(o.geocode("nowhere", miss), /couldn't find/);
});

test("spots: duplicates merged, unnamed viewpoints last, closest first", async () => {
  const spots = await o.nearbySpots(23.81, 90.41, { fetchFn: fakeFetch() });
  const names = spots.map((s) => s.name);
  assert.equal(names.filter((n) => n === "Ramna Park").length, 1);
  assert.equal(names.at(-1), "Viewpoint");
  assert.ok(spots[0].distance < spots[1].distance);
  assert.ok(!names.includes(""));
});

test("forecast keeps only daylight hours from now", async () => {
  const fc = await o.forecast(23.8, 90.4, fakeFetch());
  assert.equal(o.hhmm(fc.hours[0].time), "11:00");
  assert.equal(o.hhmm(fc.hours.at(-1).time), "17:00");
  assert.equal(fc.tomorrow, false);
  assert.equal(fc.daylightLeftMin, 6 * 60 + 25);
});

test("best window skips the rain", async () => {
  const w = o.bestWindow(await o.forecast(23.8, 90.4, fakeFetch()));
  assert.equal(w.length, 2);
  assert.ok(w.every((h) => h.rainChance < 50));
});

test("after dark it plans for tomorrow", async () => {
  const fc = await o.forecast(23.8, 90.4, fakeFetch({ now: "2026-10-05T21:00" }));
  assert.equal(fc.tomorrow, true);
  assert.equal(fc.daylightLeftMin, 0);
  assert.equal(o.dayName(fc.sunset), "Tue");
});

test("storms score far below a clear hour", () => {
  const clear = o.hourScore({ temp: 20, rainChance: 0, code: 0, wind: 5 });
  const storm = o.hourScore({ temp: 20, rainChance: 60, code: 95, wind: 40 });
  assert.ok(clear > 90 && storm < 0);
});

test("HTTP errors become OutdoorsError", async () => {
  const down = async () => ({ ok: false, status: 503 });
  await assert.rejects(o.forecast(1, 2, down), o.OutdoorsError);
});
