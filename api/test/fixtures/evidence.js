// Fixtures shaped exactly like the entries make probe recorded on Vault 2.2.1
// and PostgreSQL 17.11 (docs/capabilities.md), with synthetic values.
const ns = { id: 'Ab12c', path: 'observatory/' };
const H = (s) => `hmac-sha256:${s.padEnd(64, '0')}`;

export const CORR = 'run-6-0a1b2c3d';
export const NOOR = '5dd5a849-0000-4208-09f4-a3073f793b3e';
export const AGENT = '27ad0dea-0000-5503-05ca-6676c9fdb8e4';
export const USER = 'v-noor-finance-r-7O4DYIEd20yullaQ-1794467350';
export const LEASE = 'database/creds/finance-readonly/NLwuUk9Z0tXdwRbJ.Ab12c';

const oboAuth = {
  entity_id: NOOR,
  display_name: 'JWT Token with Unique Identifier: A055C4A2-4785-4846-83EB-FA98CFA02A2A',
  accessor: null,
  client_token: H('ct'),
  token_type: 'ent',
  policies: ['default', 'obs-noor'],
  identity_policies: ['obs-noor'],
  policy_results: { allowed: true, granting_policies: [{ type: '' }, { name: 'obs-noor', type: 'acl' }, { name: 'obs-finance-ceiling', type: 'acl' }] },
  metadata: {
    actor_entity_id: AGENT, actor_entity_name: 'finance-agent',
    jwt_audience_claim: ['https://vault.observatory.example'],
    jwt_authorization_details: [{ type: 'vault:path_access', path: 'database/creds/finance-readonly', capabilities: ['read'] }],
    jwt_issuer: 'https://issuer.corvid.example', jwt_unique_id: 'A055C4A2-4785-4846-83EB-FA98CFA02A2A',
  },
  authorization_details: [{ type: 'vault:path_access', path: 'database/creds/finance-readonly', capabilities: ['read'] }],
};
const req = (path, corr = CORR) => ({
  id: 'req-1', namespace: ns, operation: 'read', path, mount_type: 'database', remote_address: '10.89.27.156',
  headers: { 'x-correlation-id': [corr], 'x-observatory-purpose': ['monthly-reconciliation'], 'user-agent': ['node'] },
});

export const oboDbRequest = { time: '2026-11-12T08:00:00.100Z', type: 'request', auth: oboAuth, request: req('database/creds/finance-readonly') };
export const oboDbResponse = {
  time: '2026-11-12T08:00:00.200Z', type: 'response', auth: oboAuth, request: req('database/creds/finance-readonly'),
  response: { secret: { lease_id: LEASE }, data: { username: USER, password: H('pw') } },
};
export const ceilingDenied = {
  time: '2026-11-12T08:01:00.000Z', type: 'response',
  auth: { ...oboAuth, policy_results: { allowed: false } },
  request: { ...req('kv/data/finance/payroll-export', 'run-7-11112222'), id: 'req-7', mount_type: 'kv' },
  error: '2 errors occurred:\n\t* CEILING_POLICY_DENIED: actor ceiling policy denied permission\n\t* permission denied\n\n',
};
export const consoleLookup = { time: '2026-11-12T08:00:05Z', type: 'response', auth: { entity_id: '' }, request: { id: 'r9', namespace: ns, path: 'sys/leases/lookup', headers: {} } };

const pgTs = (iso) => iso.replace('T', ' ').replace('Z', ' UTC');
export const pgConnect = {
  timestamp: pgTs('2026-11-12T08:00:01.000Z'), user: USER, dbname: 'finance', pid: 77, remote_host: '10.89.27.160',
  session_id: '6af56618.db', line_num: 2, error_severity: 'LOG',
  message: `connection authorized: user=${USER} database=finance application_name=finance-agent:0a1b2c3d SSL enabled (protocol=TLSv1.3, cipher=TLS_AES_256_GCM_SHA384, bits=256)`,
};
export const pgDisconnect = {
  timestamp: pgTs('2026-11-12T08:00:02.500Z'), user: USER, dbname: 'finance', session_id: '6af56618.db', line_num: 4,
  error_severity: 'LOG', application_name: 'finance-agent:0a1b2c3d',
  message: `disconnection: session time: 0:00:01.500 user=${USER} database=finance host=10.89.27.160 port=40000`,
};
export const pgHealthcheck = { timestamp: pgTs('2026-11-12T08:00:03Z'), user: 'postgres', dbname: 'finance', session_id: 'x', line_num: 1, error_severity: 'LOG', message: 'connection authorized: user=postgres database=finance application_name=pg_isready' };
