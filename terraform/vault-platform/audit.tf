# Two devices per node (D10): a file in the node's audit volume, which the API
# reads, and stdout (the container log). Vault refuses a request only if no
# device can write. HMAC stays on; the exceptions are named in D10.
resource "vault_audit" "file" {
  type        = "file"
  path        = "file"
  description = "Evidence: read by the Identity Observatory"
  options = {
    file_path = "/vault/audit/audit.log"
    mode      = "0640" # gid 1000: the API reads it
  }
}

resource "vault_audit" "stdout" {
  type        = "file"
  path        = "stdout"
  description = "Second device: the container log"
  options = {
    file_path = "stdout"
  }
}

# The declared purpose code travels as a header (D10). X-Correlation-Id is
# audited by default (probe P20). A short governed code, never free text.
resource "vault_audit_request_header" "purpose" {
  name = "X-Observatory-Purpose"
  hmac = false
}
