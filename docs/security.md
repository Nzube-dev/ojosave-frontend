# Secrets Management

Practical guidance for keeping SorobanPay secrets out of version control and safe in production.

---

## Never commit secrets

- **`.gitignore`** — ensure these patterns are present:
  ```
  .env
  .env.local
  .env.production
  ```
- Use `backend/.env.example` (committed, no real values) as the canonical template.
- Consider a pre-commit hook to catch accidental secret commits:
  ```bash
  # .git/hooks/pre-commit  (or use the `detect-secrets` / `gitleaks` tools)
  git diff --cached --name-only | grep -qE '\.env$' && echo "ERROR: .env staged" && exit 1
  ```

---

## Local development

Copy the example file and fill in real values — never commit the result:

```bash
cp backend/.env.example backend/.env
```

Load at runtime with [dotenv](https://github.com/motdotla/dotenv):

```ts
import 'dotenv/config'; // or require('dotenv').config()
```

Only call this in development; production environments inject vars directly (see below).

---

## Production secret stores

| Option | Best for |
|--------|----------|
| **AWS Secrets Manager** | AWS-hosted deployments; supports automatic rotation |
| **HashiCorp Vault** | Self-hosted or multi-cloud; fine-grained access policies |
| **Platform env vars** | Railway, Render, Fly.io — set in the dashboard, injected at runtime |

For platform deployments (Railway/Render/Fly.io), set each variable in the project's environment settings UI. No secret store SDK is required.

For AWS Secrets Manager, retrieve at startup:

```ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: 'us-east-1' });
const { SecretString } = await client.send(
  new GetSecretValueCommand({ SecretId: 'sorobanpay/backend' })
);
const secrets = JSON.parse(SecretString!);
```

---

## Secrets reference

| Variable | Sensitivity | Notes |
|----------|-------------|-------|
| `DATABASE_URL` | 🔴 High | Contains credentials; never log or expose |
| `RPC_URL` | 🟡 Medium | High if it embeds a paid-provider API key |
| `NETWORK_PASSPHRASE` | 🟢 Low | Public value, but keep env-configurable |
| `CONTRACT_ID` | 🟢 Low | Public on-chain address; still env-configurable |
| `WEBHOOK_SECRET` | 🔴 High | Used to verify HMAC signatures on incoming webhooks |
| `OPERATOR_PRIVATE_KEY` | ⛔ Never | See note below |

### ⛔ Private keys do not belong in the backend

SorobanPay is **non-custodial**. Transaction signing happens exclusively in the browser via Freighter. The backend is read-only with respect to the chain — it polls events but never submits transactions. **Never store a Stellar private key or mnemonic in the backend environment.**

---

## Key rotation

1. **DATABASE_URL** — rotate the database password in your DB provider, update the secret in your store, redeploy (or trigger a rolling restart). Revoke the old credential immediately after.
2. **WEBHOOK_SECRET** — generate a new secret, update both the secret store and the webhook sender's configuration simultaneously to avoid dropped events during rotation.
3. **RPC API keys** — generate a new key in the provider dashboard, update `RPC_URL`, then revoke the old key.

Automate rotation where possible (AWS Secrets Manager supports scheduled Lambda-based rotation for RDS credentials).

---

## Checklist

- [ ] `.env` is in `.gitignore`
- [ ] No real values in `backend/.env.example`
- [ ] Production vars set in secret store or platform dashboard
- [ ] `DATABASE_URL` rotated at least annually (or on any suspected compromise)
- [ ] No private keys anywhere in the backend codebase or environment
