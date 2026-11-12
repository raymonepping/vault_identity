// scripts/reset.js: the stage reset's API half (D20), run inside vid-api by
// scripts/stage-reset.sh. Clears the evidence store and ingests from now on;
// Vault's audit files and PostgreSQL's log are never edited.
import { openStore } from '../lib/store.js';

const store = openStore();
store.reset();
console.log(`reset: evidence store cleared; ingesting from ${store.meta('ingest_since')}`);
store.close();
