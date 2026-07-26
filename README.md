# OpenEDL

OpenEDL is a small, self-hosted External Dynamic List manager. It collects
remote or manual feeds, normalizes entries by type, removes duplicates, applies
exclusion sources, and publishes a vendor-neutral plain-text URL.

## MVP capabilities

- IP, domain, and URL list types
- Plain text, CSV, and JSON-value ingestion
- Include and exclude source rules
- Last-known-good caching when an upstream feed fails
- Persistent SQLite source and list configuration
- ETag and edge-cache headers on published endpoints
- OIDC SSO for Google, Microsoft Entra ID, and custom providers
- Local email/password authentication and admin-managed users
- Admin/member roles, account disabling, deletion, and session revocation
- GUI-managed OIDC providers with AES-GCM encrypted client secrets
- Self-service account profiles and local credential rotation
- In-place editing and validation for manual EDL sources
- Editable published-list names, descriptions, and endpoint URL slugs
- Admin-controlled Signal, Ocean, Ember, and Midnight themes across the app
- Configurable public endpoint origin for reverse-proxy deployments
- HttpOnly database-backed management sessions with PKCE and nonce validation
- Optional bearer-token recovery access for the management API
- Per-source refresh schedules from five minutes to weekly
- Built-in container scheduling, Cloudflare scheduled-handler, and external cron support
- Basic SSRF and response-size protections for remote sources

## Deployment options

OpenEDL supports two deployment types:

| Deployment | Runtime and storage | Best for |
| --- | --- | --- |
| **Docker (recommended)** | Node.js container with persistent SQLite | Self-hosting, simple backups, and portable deployments |
| **Cloudflare Workers** | Cloudflare Workers with D1 and Cron Triggers | Serverless edge hosting without managing a container host |

Both targets run the same application and authentication features. Choose one
storage backend for a deployment; Docker SQLite and Cloudflare D1 do not
automatically synchronize.

## Recommended deployment: Docker

The supported container image is published to the GitHub Container Registry for
both AMD64 and ARM64:

```text
ghcr.io/emmolab/openedl:latest
```

Copy the environment template, configure the public URL and at least one
management access method, then start the service:

```bash
cp .env.example .env
docker compose up -d
```

OpenEDL is available on `http://localhost:3000` by default. Set `OPENEDL_PORT`
in `.env` to change the host port.

The Compose deployment stores the SQLite database in the `openedl-data` volume.
Back up that volume regularly and run only one OpenEDL container against a
given database volume. Updates are applied with:

```bash
docker compose pull
docker compose up -d
```

Set a strong `CRON_SECRET` in `.env` to enable the container's automatic
five-minute refresh check:

```bash
openssl rand -hex 32
```

If `CRON_SECRET` is unset, automatic refreshes remain disabled and the service
logs a warning.

### Publishing the image

The `Publish container image` GitHub Actions workflow builds and tests the image
for pull requests. Pushes to `main` publish `latest`, `main`, and commit-SHA
tags to GHCR. Version tags publish matching semantic-version image tags:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow uses the repository's `GITHUB_TOKEN`; no registry password is
required. For a public repository, confirm the resulting `openedl` package is
also set to public visibility in the repository or organization package
settings.

## Local development

Local development requires Node.js 24.15 or newer and uses
`./data/openedl.sqlite` unless `DATABASE_PATH` is set.

```bash
cp .env.example .env
npm ci
npm run dev
```

The dashboard is available at `http://localhost:3000`. The seeded list is
published at `http://localhost:3000/edl/perimeter-blocklist`.

The default remote feeds include the Emerging Threats firewall IP blocklist at
`https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt`.

Copy `.env.example` to `.env` and configure at least one management access
method. Localhost allows a development-only bypass when no provider or admin
token is configured; non-local deployments fail closed.

### Local accounts

Administrators can add, disable, promote, demote, reset, and delete users from
the **Users** screen. Local passwords are salted and hashed with
PBKDF2-HMAC-SHA256 at 600,000 iterations. Five failed attempts lock an account
for 15 minutes.

For the first production login, configure
`LOCAL_AUTH_BOOTSTRAP_EMAIL`, `LOCAL_AUTH_BOOTSTRAP_PASSWORD`, and optionally
`LOCAL_AUTH_BOOTSTRAP_NAME`. The bootstrap account is created as an
administrator on its first sign-in. Remove the bootstrap password secret after
that account exists. You can alternatively use OIDC or `ADMIN_TOKEN` to enter
the dashboard and create the first local user.

### GUI-managed SSO

See the dedicated [SSO configuration guide](docs/SSO.md) for complete Google,
Microsoft Entra ID, custom OIDC, allowlist, proxy, rotation, and troubleshooting
instructions.

Set `CONFIG_ENCRYPTION_KEY` to a base64-encoded 32-byte key before adding SSO
providers from **SSO settings**:

```bash
openssl rand -base64 32
```

The key remains a deployment secret. Provider client secrets entered through
the GUI are encrypted with AES-256-GCM before database storage and are never
returned by the API. Keep the key backed up; changing or losing it makes
existing GUI-managed client secrets unreadable. Environment-configured
providers remain supported and appear as read-only entries in the GUI.

### Google SSO

Create a Google OAuth web client and register:

```text
https://YOUR_HOST/api/auth/callback/google
```

Set `GOOGLE_OIDC_CLIENT_ID` and `GOOGLE_OIDC_CLIENT_SECRET`.

### Microsoft SSO

Create a Microsoft Entra ID web app registration and register:

```text
https://YOUR_HOST/api/auth/callback/microsoft
```

Set `MICROSOFT_OIDC_CLIENT_ID`, `MICROSOFT_OIDC_CLIENT_SECRET`, and
`MICROSOFT_OIDC_TENANT_ID`. A tenant UUID is the safest default for an internal
deployment.

Use `AUTH_ALLOWED_DOMAINS` and/or `AUTH_ALLOWED_EMAILS` to restrict who may
manage the service after authentication.

### Scheduled refreshes

The Docker entrypoint checks for due sources every five minutes when
`CRON_SECRET` is configured. Each source can be set to 5, 15, or 30 minutes;
hourly; every 6 or 12 hours; daily; or weekly. External schedulers can call
`POST /api/cron/refresh` with `Authorization: Bearer $CRON_SECRET`.

## Cloudflare Workers deployment

Cloudflare is a fully supported alternative using Workers, D1, static assets,
Image Resizing, and a five-minute Cron Trigger. Create a D1 database, place its
ID in the ignored `.env.cloudflare` file, then deploy:

```bash
cp .env.cloudflare.example .env.cloudflare
npx wrangler d1 create openedl
npm run deploy:cloudflare
```

The deployment command builds the Cloudflare target and deploys it with
Wrangler. No `.openai` directory, account identifier, database identifier, or
application secret is committed to the repository.

See the [Cloudflare deployment guide](docs/CLOUDFLARE.md) for authentication,
secrets, local development, custom domains, and updates.

## Current scope

Source request authentication, list creation, audit history, and richer
JSON-path or STIX/TAXII transforms remain for the next milestone.
