// lib/rate.js: a sliding-window counter. server.js allows 10 sign-ins and 30
// case runs a minute; Vault's own userpass lockout guards the password.
export function createRate({
  max,
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
