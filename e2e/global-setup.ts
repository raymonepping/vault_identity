// global-setup.ts: fail fast, with the make target that fixes it, when the
// stack is not up; a fresh stage; then sign in once as noor through the
// console's own form and keep the session for every journey.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { labCaSpkiArg, servedHeaders, stageReset } from './helpers/env';
import { signIn } from './helpers/auth';

const CORE = ['vid-vault_s', 'vid-vault_1', 'vid-vault_2', 'vid-vault_3', 'vid-postgres', 'vid-api', 'vid-web'];
export const STORAGE = path.join(__dirname, '.auth/noor.json');

export default async function globalSetup(): Promise<void> {
  const running = execFileSync('podman', ['ps', '--filter', 'name=^vid-', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n');
  const down = CORE.filter((c) => !running.includes(c));
  if (down.length) throw new Error(`not running: ${down.join(', ')}: run "make up"`);
  const h = await servedHeaders('/api/healthz').catch(() => null);
  if (!h) throw new Error('the console does not answer /api/healthz: run "make doctor"');
  stageReset();
  const browser = await chromium.launch({ args: [labCaSpkiArg()] });
  const page = await browser.newPage();
  await signIn(page);
  await page.context().storageState({ path: STORAGE });
  await browser.close();
}
