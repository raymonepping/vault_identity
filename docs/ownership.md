# Ownership

Who creates, changes and removes each object. Terraform never owns what a
case or a reset changes; `make tf-plan-all` stays empty after both.

| Object | Owner | Notes |
| --- | --- | --- |
| vault-s, its Transit key and token role | Terraform `vault-seal` | |
| Seal tokens, init, root revocation | Ansible (`seal-init`, `seal-tokens`, `bootstrap`) | |
| Audit devices `file`, `stdout`; audited header `X-Observatory-Purpose` | Terraform `vault-platform` | root namespace |
| Namespace `observatory`, mounts, auth methods, AppRole role, token role `obs-console` | Terraform | |
| Database connection (bootstrap password write-only) and role `finance-readonly` | Terraform | the password is ephemeral, never in state |
| The database root password after the first run | Vault (`rotate-root`, Ansible `data`) | nobody else knows it |
| Schema and rows of `finance` | Ansible `data` | through the local socket (peer auth) |
| `obs-*` policies, entities, Noor's userpass alias | Terraform | |
| Profile aliases | Terraform (`vault_generic_endpoint`, `profile_name`) | read and delete off; an alias goes with its entity |
| OAuth profile `corvid-issuer`, Agent Registry records | Terraform (`vault_generic_endpoint`) | |
| Noor's password, the AppRole secret id, the console token | Ansible `people` | |
| KV values and their labels | Ansible `stage` | values written once, never read back |
| The issuer key pair | `make gen-certs` | created once |
| Case runs, the credentials they get, the evidence store | the API | `make stage-reset` revokes and clears |
