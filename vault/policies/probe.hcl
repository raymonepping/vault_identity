# vid-probe: prompt 03's scratch probe (make probe). Minted by Ansible
# (bootstrap) with a 4h TTL before root is revoked (docs/STATE.md). Everything
# it may touch lives in a scratch namespace probe-<epoch>, deleted at the end
# of every probe run, plus a scratch audit device and scratch audited headers.
# It has no path in observatory.

path "sys/namespaces" { capabilities = ["list"] }
path "sys/namespaces/probe-*" { capabilities = ["create", "read", "update", "delete"] }
# Everything inside a scratch namespace (mounts, auth, policies, identity,
# OAuth profiles, the Agent Registry, tokens, leases).
path "probe-*" { capabilities = ["create", "read", "update", "delete", "list", "patch", "sudo"] }

# Audit rules (scratch device and headers; sudo: Vault requires it).
path "sys/audit" { capabilities = ["read", "sudo"] }
path "sys/audit/probe-file" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/audit-hash/probe-file" { capabilities = ["update"] }
path "sys/config/auditing/request-headers" { capabilities = ["read", "sudo"] }
path "sys/config/auditing/request-headers/x-probe-*" { capabilities = ["create", "read", "update", "delete", "sudo"] }

path "sys/license/status" { capabilities = ["read"] }
path "sys/storage/raft/configuration" { capabilities = ["read"] }
path "auth/token/lookup-self" { capabilities = ["read"] }

path "observatory/*" { capabilities = ["deny"] }
path "sys/namespaces/observatory" { capabilities = ["deny"] }
path "sys/policies/acl/vid-*" { capabilities = ["deny"] }
