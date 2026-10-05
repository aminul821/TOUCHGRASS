import assert from "node:assert/strict";
import test from "node:test";
import { emptyJournal, liveStreak, logOuting, totalDays } from "../js/journal.js";

test("streaks grow on consecutive days and reset after a gap", () => {
  let j = emptyJournal();
  let r = logOuting(j, { at: 1 }, "2026-10-04");
  assert.equal(r.newDay, true);
  j = r.journal;
  r = logOuting(j, { at: 2 }, "2026-10-04");
  assert.equal(r.newDay, false);
  j = r.journal;
  j = logOuting(j, { at: 3 }, "2026-10-05").journal;
  assert.equal(j.streak, 2);
  j = logOuting(j, { at: 4 }, "2026-10-08").journal;
  assert.deepEqual([j.streak, j.best, totalDays(j), j.entries.length], [1, 2, 3, 4]);
});

test("streaks cross month ends", () => {
  let j = logOuting(emptyJournal(), {}, "2026-10-31").journal;
  j = logOuting(j, {}, "2026-11-01").journal;
  assert.equal(j.streak, 2);
});

test("the live streak drops to 0 once a day is missed", () => {
  const j = logOuting(emptyJournal(), {}, "2026-10-04").journal;
  assert.equal(liveStreak(j, "2026-10-05"), 1);
  assert.equal(liveStreak(j, "2026-10-06"), 0);
});
