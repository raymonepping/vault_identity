// The cases through the console, as the presenter runs them: each Run button
// makes real requests; the investigation must show the states the brief
// expects (prompts/00_brief.md, config/cases.json).
import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const run = async (page: Page, id: number) => {
  await page.goto('/#/cases');
  await page.getByRole('button', { name: `Run case ${id}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/run/run-${id}-[0-9a-f]{8}$`));
  return page.url().split('/').pop() as string;
};
const link = (page: Page, name: string) => page.locator('.chain__link').filter({ has: page.locator('.chain__name', { hasText: new RegExp(`^${name}$`) }) });

let unused = '';

test('case 9 first: a credential nobody uses', async ({ page }) => {
  unused = await run(page, 9);
  await expect(link(page, 'Issued')).toContainText('Confirmed');
  await expect(link(page, 'Used')).toContainText('Partial');
});

test('case 1: Noor reads the key; use stays Partial and says why', async ({ page }) => {
  await run(page, 1);
  await expect(link(page, 'Requested')).toContainText('Confirmed');
  await expect(link(page, 'Used')).toContainText('no application reported using it');
  await expect(page.locator('.vg-hero')).toContainText('issued version 1 of the secret');
});

test('case 6: the finance agent for Noor; both principals and the ceiling recorded', async ({ page }) => {
  await run(page, 6);
  await expect(page.locator('.lanes')).toContainText('noor');
  await expect(page.locator('.lanes')).toContainText('finance-agent');
  await expect(link(page, 'Used')).toContainText('Correlated');
  await expect(page.locator('#dec-h').locator('..').locator('..')).toContainText('obs-finance-ceiling');
});

test('case 7: the ceiling says no, verbatim', async ({ page }) => {
  await run(page, 7);
  await expect(page.locator('.vg-hero')).toContainText('CEILING_POLICY_DENIED');
  await expect(link(page, 'Issued')).toContainText('not applicable');
});

test('case 9 after its window: Unmatched, worded precisely', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(`/#/run/${unused}`);
  await expect(link(page, 'Used')).toContainText('Unmatched', { timeout: 120_000 });
  await expect(link(page, 'Used')).toContainText('no matching connection observed');
});

test('signed out: the console asks for Noor', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/#/cases');
  await expect(page.locator('#signin-user')).toHaveValue('noor');
  await ctx.close();
});
