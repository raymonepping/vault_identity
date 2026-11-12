// helpers/auth.ts: sign in the way the presenter does: the console's own
// form, as noor; the API logs her in to Vault and sets a session cookie.
import { expect, type Page } from '@playwright/test';
import { personPassword, urls } from './env';

export async function signIn(page: Page, user = 'noor', route = 'overview') {
  await page.goto(`${urls.web}/#/${route}`);
  await page.locator('#signin-user').fill(user);
  await page.locator('#signin-pw').fill(personPassword(user));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.persona')).toBeVisible();
}
