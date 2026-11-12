// lib/vault.js: the only place the API talks to Vault (from vault_codex).
//
// Who acts is explicit (D11, D14): every call names its token (or JWT). The
// console's own token is read from its file on EVERY call, so a token Ansible
// re-mints (make people) is picked up at once; there is no VAULT_TOKEN
// variable. A principal's call carries that principal's own credential
// (lib/session.js for Noor, lib/cases.js for the agents and the workload).
//
// Every story path lives in namespace observatory: callers name it with ns().
// Every call goes to the ACTIVE node (sys/leader, cached for a few seconds);
// the collector reads all three audit files anyway. TLS:
// NODE_EXTRA_CA_CERTS adds the lab CA. Nothing disables verification.
//
// call() never throws for a Vault refusal: the story needs Vault's answer
// (status, errors verbatim, request id) as data. It throws VaultError only
// when Vault cannot be reached.
import { readFileSync } from "node:fs";

export const VAULT_NODES = (
  process.env.VAULT_NODES ||
  "https://vault-1:8200,https://vault-2:8200,https://vault-3:8200"
)
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
const NAMESPACE = process.env.VID_NAMESPACE || "observatory";
const TOKEN_FILE = process.env.CONSOLE_TOKEN_FILE || "/run/secrets/vault/console";
const ACTIVE_TTL_MS = 5_000;

// A path in the story's namespace.
export const ns = (path) => `${NAMESPACE}/${path}`;

export class VaultError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The console's own token (obs-console, D14): identity and configuration reads,
// lease lookups, and revoking finance-readonly leases.
export function consoleToken() {
  let token = "";
  try {
    token = readFileSync(TOKEN_FILE, "utf8").trim();
  } catch (e) {
    throw new VaultError(503, `the console token is not readable (${TOKEN_FILE}): ${e.code || e.message}; run make people`);
  }
  if (!token) throw new VaultError(503, `the console token file is empty (${TOKEN_FILE}); run make people`);
  return token;
}

export function tokenPresent() {
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

// A referenced setTimeout aborts the whole exchange, body included
// (AbortSignal.timeout was seen never to fire on a hung connection).
async function fetchWithTimeout(url, opts, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(
    () => ac.abort(new Error(`timed out after ${timeoutMs} ms`)),
    timeoutMs,
  );
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    return { res, text: await res.text() };
  } catch (e) {
    throw new VaultError(
      ac.signal.aborted ? 504 : 503,
      `Vault ${opts.method || "GET"} ${url.replace(/^.*\/v1\//, "")}: ${ac.signal.reason?.message || e?.cause?.code || e.message}`,
    );
  } finally {
    clearTimeout(t);
  }
}

let active = { addr: null, at: 0 };

async function activeAddr() {
  if (active.addr && Date.now() - active.at < ACTIVE_TTL_MS) return active.addr;
  for (const addr of VAULT_NODES) {
    try {
      const { text } = await fetchWithTimeout(
        `${addr}/v1/sys/leader`,
        { method: "GET" },
        3_000,
      );
      if (JSON.parse(text)?.is_self) {
        active = { addr, at: Date.now() };
        return addr;
      }
    } catch {
      // try the next node
    }
  }
  active = { addr: null, at: 0 };
  throw new VaultError(503, "no active Vault node among vault-1..3");
}

const nodeName = (addr) =>
  String(addr || "").replace(/^https?:\/\/([^:/]+).*/, "$1");

// call(token | null, METHOD, path, { body, headers, timeoutMs })
//   -> { ok, status, json, errors, requestId, node }
export async function call(
  token,
  method,
  path,
  { body, headers = {}, timeoutMs = 15_000 } = {},
) {
  const h = { ...headers };
  if (token) h["X-Vault-Token"] = token;
  if (body !== undefined) h["content-type"] = "application/json";
  const addr = await activeAddr();
  let res, text;
  try {
    ({ res, text } = await fetchWithTimeout(
      `${addr}/v1/${path}`,
      {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      timeoutMs,
    ));
  } catch (e) {
    active = { addr: null, at: 0 };
    throw e;
  }
  if (res.status === 503 || res.status === 500) active = { addr: null, at: 0 };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  // Some refusals arrive as data.error, not errors (probe P3).
  const raw = json?.errors?.length ? json.errors : json?.data?.error && !res.ok ? [json.data.error] : [];
  const errors = raw.map((e) =>
    String(e).replace(/\s+/g, " ").trim(),
  );
  return {
    ok: res.ok,
    status: res.status,
    json,
    errors,
    requestId: json?.request_id || null,
    node: nodeName(addr),
  };
}

// Unauthenticated sys/health of one node.
export async function nodeHealth(addr) {
  try {
    const { text } = await fetchWithTimeout(
      `${addr}/v1/sys/health?standbyok=true&perfstandbyok=true&sealedcode=200&uninitcode=200`,
      { method: "GET" },
      4_000,
    );
    const j = JSON.parse(text);
    return {
      node: nodeName(addr),
      reachable: true,
      initialized: Boolean(j.initialized),
      sealed: Boolean(j.sealed),
      standby: Boolean(j.standby),
      performanceStandby: Boolean(j.performance_standby),
      version: j.version || null,
    };
  } catch (e) {
    return {
      node: nodeName(addr),
      reachable: false,
      error: String(e?.message || e),
    };
  }
}
