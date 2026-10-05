// Streaks and the grass journal. Pure functions over a plain object; app.js keeps it
// in localStorage, so it lives only on this device.

export const emptyJournal = () => ({ entries: [], streak: 0, best: 0, last: "" });

const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// The streak as of `today`: it's broken if the last outing was before yesterday.
export const liveStreak = (j, today) => (j.last === today || j.last === dayBefore(today) ? j.streak : 0);

// Add a verified outing. Returns {journal, newDay}.
export function logOuting(journal, entry, today) {
  const j = { ...journal, entries: [{ ...entry, day: today }, ...journal.entries].slice(0, 60) };
  if (j.last === today) return { journal: j, newDay: false };
  j.streak = j.last === dayBefore(today) ? j.streak + 1 : 1;
  j.best = Math.max(j.best, j.streak);
  j.last = today;
  return { journal: j, newDay: true };
}

export const totalDays = (j) => new Set(j.entries.map((e) => e.day)).size;

export function localDay(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
