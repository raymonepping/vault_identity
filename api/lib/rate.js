// lib/rate.js: 20 answer attempts per minute per session (a rehearsal plays
// the show twice in a minute). Stage pacing, not
// security: Vault's context is the gate ("Context is not a password").
export function createRate({
  max = 20,
  windowMs = 60_000,
  now = () => Date.now(),
} = {}) {
  const hits = new Map(); // key -> timestamps
  return {
    take(key) {
      const t = now();
      const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return { ok: false, retryAfterMs: windowMs - (t - list[0]) };
      }
      list.push(t);
      hits.set(key, list);
      return { ok: true, left: max - list.length };
    },
  };
}
