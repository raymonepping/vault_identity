import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { check } from './cases-check.js';

const doc = () => JSON.parse(readFileSync(new URL('../config/cases.json', import.meta.url)));

test('the shipped cases are valid', () => {
  assert.deepEqual(check(doc()), []);
});

test('a wildcard RAR path is refused', () => {
  const d = doc();
  d.cases[2].rar[0].path = 'kv/data/finance/*';
  assert.match(check(d).join(), /no wildcard/);
});

test('an OBO case without a subject is refused', () => {
  const d = doc();
  delete d.cases[4].subject;
  assert.match(check(d).join(), /needs a known subject/);
});

test('a denied case cannot expect use', () => {
  const d = doc();
  d.cases[6].expect.use = 'Correlated';
  assert.match(check(d).join(), /no use/);
});

test('a human case cannot carry RAR', () => {
  const d = doc();
  d.cases[0].rar = [];
  assert.match(check(d).join(), /agent cases carry rar/);
});
