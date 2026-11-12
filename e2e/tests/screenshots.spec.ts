// @shots: refresh docs/screenshots (make screenshots). Not part of make test-ui.
// Runs enough cases that each page has something to show.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { ROOT } from '../helpers/env';

const OUT = path.join(ROOT, 'docs/screenshots');
test.describe.configure({ mode: 'serial' });
test.use({ bypassCSP: true });

const shoot = async (page: Page, id: string) => {
  for (const vp of [{ n: 'desktop', width: 1440, height: 900 }, { n: 'phone', width: 390, height: 844 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(700);
    await page.addStyleTag({ content: '.topbar-wrap{position:static!important}.vg-sidebar{position:static!important;height:auto!important;min-height:100%!important}.skip-link{display:none!important}' });
    await page.screenshot({ path: path.join(OUT, `${id}${vp.n === 'phone' ? '-phone' : ''}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
};
const run = async (page: Page, id: number) => {
  await page.goto('/#/cases');
  await page.getByRole('button', { name: `Run case ${id}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/run/run-${id}-`));
};

test('@shots the observatory', async ({ page }) => {
  test.setTimeout(240_000);
  for (const id of [9, 1, 2, 3, 5, 7, 8, 10]) await run(page, id);
  await run(page, 6);
  await expect(page.locator('.chain__link').filter({ has: page.locator('.chain__name', { hasText: /^Used$/ }) })).toContainText('Correlated');
  await shoot(page, 'investigation-obo');
  await run(page, 10);
  await expect(page.locator('.inline-notice.warn')).toBeVisible();
  await shoot(page, 'investigation-revoked');
  await run(page, 7);
  await shoot(page, 'investigation-denied');
  for (const id of ['overview', 'cases', 'identities', 'secrets', 'timeline']) {
    await page.goto(`/#/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await shoot(page, id);
  }
});
