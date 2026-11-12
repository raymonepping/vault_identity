// What the console serves: TLS 1.3 from the lab CA, a strict CSP, no secret,
// no run a page could steer.
import { test, expect } from '@playwright/test';
import { kvValues, servedHeaders, servedLeaf, servedPost } from '../helpers/env';

test('TLS 1.3, certificate from the lab CA', async () => {
  const { protocol, cert } = await servedLeaf();
  expect(protocol).toBe('TLSv1.3');
  expect(cert.issuer.CN).toContain('Lab CA');
});

test('a Content-Security-Policy without unsafe-inline scripts', async () => {
  const h = await servedHeaders('/');
  const csp = String(h['content-security-policy']);
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
});

test('no KV value in a served bundle or in /api/cases', async ({ page }) => {
  await page.goto('/');
  const scripts = await page.locator('script[src]').evaluateAll((s) => s.map((x) => (x as HTMLScriptElement).src));
  const bodies = [...(await Promise.all(scripts.map((src) => page.evaluate((u) => fetch(u).then((r) => r.text()), src)))), await page.evaluate(() => fetch('/api/cases').then((r) => r.text()))];
  for (const v of kvValues) for (const b of bodies) expect(b.includes(v)).toBe(false);
});

test('a write from another origin is refused', async () => {
  expect(await servedPost('/api/cases/1/run', { origin: 'https://localhost:13701' })).toBe(403);
  expect(await servedPost('/api/session', { 'sec-fetch-site': 'cross-site' })).toBe(403);
});

test('a run takes no parameters: a body that tries to set a path is refused', async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(() =>
    fetch('/api/cases/1/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'kv/data/finance/payroll-export' }) }).then((r) => r.status),
  );
  expect(status).toBe(400);
});
