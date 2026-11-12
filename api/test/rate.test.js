import { test } from "node:test";
import assert from "node:assert/strict";
import { createRate } from "../lib/rate.js";

test("20 answers per minute per session, then a pause", () => {
  let t = 0;
  const r = createRate({ now: () => t });
  for (let i = 0; i < 20; i++) assert.ok(r.take("s").ok);
  const no = r.take("s");
  assert.equal(no.ok, false);
  assert.ok(r.take("other").ok);
  t = 60_001;
  assert.ok(r.take("s").ok);
});
