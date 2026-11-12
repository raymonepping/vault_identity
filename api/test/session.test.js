import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessions, crossSiteWrite, parseCookies, sessionCookie, Refused, Unauthenticated, COOKIE } from "../lib/session.js";

const ok = (lease = 3600) => ({ ok: true, status: 200, json: { auth: { client_token: "tok-noor", lease_duration: lease, entity_id: "e1", token_policies: ["default", "obs-noor"] } }, errors: [] });
const req = (cookie, extra = {}) => ({ headers: { cookie, ...extra }, method: "GET" });

test("only noor may sign in to the console", async () => {
  const s = createSessions({ login: async () => ok(), revoke: async () => {} });
  await assert.rejects(s.signIn("ledger-agent", "x"), (e) => e instanceof Refused && e.status === 403);
});

test("a refused password is Vault's answer, as 401", async () => {
  const s = createSessions({ login: async () => ({ ok: false, status: 400, errors: ["invalid username or password"] }), revoke: async () => {} });
  await assert.rejects(s.signIn("noor", "wrong"), (e) => e.status === 401 && /invalid username/.test(e.message));
});

test("the session holds the token server side; the cookie only an id", async () => {
  const s = createSessions({ login: async () => ok(), revoke: async () => {} });
  const { sid } = await s.signIn("noor", "pw");
  assert.ok(!sid.includes("tok-noor"));
  const got = s.get(req(`${COOKIE}=${sid}`));
  assert.equal(got.token, "tok-noor");
  assert.equal(got.user, "noor");
});

test("idle sessions and expired tokens end", async () => {
  let t = 0;
  const s = createSessions({ login: async () => ok(10), revoke: async () => {}, now: () => t, idleMs: 5_000 });
  const { sid } = await s.signIn("noor", "pw");
  t = 6_000;
  assert.throws(() => s.get(req(`${COOKIE}=${sid}`)), Unauthenticated);
  const b = await s.signIn("noor", "pw");
  t = 17_000;
  assert.throws(() => s.get(req(`${COOKIE}=${b.sid}`)), Unauthenticated);
});

test("sign-out revokes the token", async () => {
  const revoked = [];
  const s = createSessions({ login: async () => ok(), revoke: async (t) => revoked.push(t) });
  const { sid } = await s.signIn("noor", "pw");
  assert.equal(await s.signOut(req(`${COOKIE}=${sid}`)), true);
  assert.deepEqual(revoked, ["tok-noor"]);
  assert.throws(() => s.get(req(`${COOKIE}=${sid}`)), Unauthenticated);
});

test("the cookie is HttpOnly, Secure and SameSite=Strict", () => {
  const c = sessionCookie("abc", 60);
  for (const part of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(c.includes(part), part);
});

test("a write from another site or origin is refused; reads and same-origin writes pass", () => {
  const w = (h) => ({ method: "POST", headers: h });
  assert.equal(crossSiteWrite(w({ "sec-fetch-site": "same-site" })), true);
  assert.equal(crossSiteWrite(w({ origin: "https://localhost:13701" }), "https://localhost:14001"), true);
  assert.equal(crossSiteWrite(w({ "sec-fetch-site": "same-origin", origin: "https://localhost:14001" }), "https://localhost:14001"), false);
  assert.equal(crossSiteWrite({ method: "GET", headers: { "sec-fetch-site": "cross-site" } }), false);
});

test("parseCookies keeps the first value and survives a broken one", () => {
  assert.deepEqual(parseCookies("a=1; a=2; b=%E0%A4%A"), { a: "1" });
});
