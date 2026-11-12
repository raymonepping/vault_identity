#!/usr/bin/env node
// scripts/cases-check.js: validate config/cases.json (the ten cases and their
// principals) and print a digest. Standard library only. Exit 1 on any error.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FLOWS = new Set(['human', 'workload', 'agent_autonomous', 'agent_obo']);
const STEPS = new Set(['read', 'creds', 'connect', 'query', 'disconnect', 'reconnect', 'revoke', 'app-event']);
const CAPS = new Set(['read', 'create', 'update', 'delete', 'list', 'patch']);
const STATES = new Set(['Confirmed', 'Correlated', 'Partial', 'Unmatched', 'Unknown', 'none']);
const PURPOSE = /^[a-z0-9-]{3,40}$/;

export function check(doc) {
  const errors = [];
  const err = (m) => errors.push(m);
  const principals = doc.principals ?? {};
  const secrets = doc.secrets ?? {};
  for (const [name, p] of Object.entries(principals)) {
    if (!FLOWS.has(p.flow)) err(`principal ${name}: unknown flow ${p.flow}`);
  }
  const ids = new Set();
  for (const c of doc.cases ?? []) {
    const at = `case ${c.id}`;
    if (!Number.isInteger(c.id) || ids.has(c.id)) err(`${at}: id must be a unique integer`);
    ids.add(c.id);
    if (!c.title) err(`${at}: no title`);
    const p = principals[c.principal];
    if (!p) err(`${at}: unknown principal ${c.principal}`);
    else if (p.flow !== c.flow) err(`${at}: flow ${c.flow} differs from ${c.principal}'s ${p.flow}`);
    const s = secrets[c.secret];
    if (!s) err(`${at}: unknown secret ${c.secret}`);
    if (!PURPOSE.test(c.purpose ?? '')) err(`${at}: purpose must be a short code (${PURPOSE})`);
    if (!Array.isArray(c.steps) || !c.steps.length || c.steps.some((x) => !STEPS.has(x))) err(`${at}: bad steps`);
    if (s && s.kind === 'kv_v2' && c.steps.includes('creds')) err(`${at}: a KV secret has no credentials step`);
    if (s && s.kind === 'leased_dynamic' && c.steps.includes('read')) err(`${at}: a dynamic secret is requested with creds`);
    const agent = c.flow.startsWith('agent_');
    if (agent !== Array.isArray(c.rar)) err(`${at}: agent cases carry rar, others do not`);
    for (const r of c.rar ?? []) {
      if (r.type !== 'vault:path_access') err(`${at}: rar type must be vault:path_access`);
      if (typeof r.path !== 'string' || /[*+]/.test(r.path) || r.path.split('/').length < 3) err(`${at}: rar path must name one secret, no wildcard`);
      if (!Array.isArray(r.capabilities) || !r.capabilities.length || r.capabilities.some((x) => !CAPS.has(x))) err(`${at}: bad rar capabilities`);
    }
    if (c.flow === 'agent_obo' && !principals[c.subject]) err(`${at}: an OBO case needs a known subject`);
    if (c.flow !== 'agent_obo' && c.subject) err(`${at}: only OBO cases have a subject`);
    const e = c.expect ?? {};
    if (!['allowed', 'denied'].includes(e.vault)) err(`${at}: expect.vault must be allowed or denied`);
    if (!STATES.has(e.request) || !STATES.has(e.use)) err(`${at}: unknown expected evidence state`);
    if (e.vault === 'denied' && e.use !== 'none') err(`${at}: a denied request has no use`);
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL('../config/cases.json', import.meta.url);
  const raw = readFileSync(file);
  const errors = check(JSON.parse(raw));
  if (errors.length) {
    for (const e of errors) console.error(`cases-check: ${e}`);
    process.exit(1);
  }
  const doc = JSON.parse(raw);
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  console.log(`cases-check: ${doc.cases.length} cases, ${Object.keys(doc.principals).length} principals, digest ${digest}`);
}
