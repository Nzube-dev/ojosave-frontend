# PR: Add backend logging of transaction responses and errors (Closes #145)

Summary

Ensure backend contract submission workflows log complete transaction responses and error details for debugging and auditing.

Why

Incomplete logging makes it difficult to troubleshoot failed `execute_payment` or `subscribe` calls. This document proposes the logging changes and the minimal implementation approach.

Proposed changes

- Log full RPC request payloads and response envelopes for contract submission flows.
- Record transaction hashes and result XDR strings when available.
- Capture and log detailed failure reasons from Soroban node metadata and RPC error objects.
- Ensure sensitive fields (private keys, secrets) are redacted before logging.
- Add structured JSON logs including: `timestamp`, `service`, `endpoint`, `rpc_request`, `rpc_response`, `tx_hash`, `result_xdr`, `error_detail`, `request_id`.

Files touched (suggested)

- `backend/src/services/*` - update submission helpers to capture responses and errors.
- `backend/src/lib/logger.ts` - ensure structured JSON logging and redaction helpers.
- `backend/README.md` - document logging formats and retention guidance.

Testing

- Add unit tests validating logged fields are present and sensitive fields are redacted.
- Add an integration smoke test that simulates a failed transaction and asserts logs contain `tx_hash` and `error_detail`.

Notes

This PR contains the design and proposed changes only. Implementation can be split into a follow-up PR if preferred.

Closes #145
