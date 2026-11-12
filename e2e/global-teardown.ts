// global-teardown.ts: leave an empty evidence store and no open credential behind.
import { stageReset } from './helpers/env';

export default async function globalTeardown(): Promise<void> {
  stageReset();
}
