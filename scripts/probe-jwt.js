#!/usr/bin/env node
// scripts/probe-jwt.js <private key file> <claims json file> [typ] [kid]: print
// one ES256 JWT. The probe (prompt 03) signs with a throwaway key; the
// rehearsal signs its refusal cases (unknown subject, wrong audience,
// expired) with the lab issuer's key, read from its file. Nothing secret is on the command line: both
// arguments are file paths. iat/exp are filled in when absent.
import { readFileSync } from 'node:fs';
import { signJwt } from '../api/lib/jwt.js';

const [keyFile, claimsFile, typ, kid] = process.argv.slice(2);
const claims = JSON.parse(readFileSync(claimsFile, 'utf8'));
const now = Math.floor(Date.now() / 1000);
claims.iat ??= now;
claims.exp ??= now + 300;
process.stdout.write(signJwt(claims, { key: readFileSync(keyFile), kid: kid || 'probe-1', typ: typ || 'at+jwt' }));
