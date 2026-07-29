# OpenEDL

OpenEDL is a small, self-hosted External Dynamic List manager. It collects
remote or manual feeds, normalizes entries by type, removes duplicates, applies
exclusion sources, and publishes a vendor-neutral plain-text URL.

## MVP capabilities

- IP, domain, and URL list types
- Plain text, CSV, and JSON-value ingestion
- Manual CSV file uploads with quoted-field parsing
- Authenticated API sources with encrypted API keys or bearer tokens
- Recorded Future risk-list preset using `X-RFToken`
- Optional JSON value paths for nested vendor API responses
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
- HttpOnly database-backed management sessions with PKCE and nonce validation
- Optional bearer-token recovery access for the management API
- Per-source refresh schedules from five minutes to weekly
- Administrator-configurable remote and authenticated API response limits
- Administrator portal database statistics and SQLite VACUUM controls
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

Copy the environment template, configure the public URL, then start the
service:

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

That volume survives container recreation. The setup screen appears only when
the database contains no users, so an administrator created by an earlier
deployment remains in place after an upgrade. Do not remove a production data
volume to recover access; use the password-reset command below.

The container automatically checks for due sources every five minutes. It
generates an internal scheduler token when `CRON_SECRET` is empty. Set a strong,
stable `CRON_SECRET` in `.env` only when an external scheduler also needs to
invoke the refresh endpoint:

```bash
openssl rand -hex 32
```

The container logs the number of refreshed and failed sources after every
scheduler run.

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

Copy `.env.example` to `.env`. A new database opens a one-time setup screen
where you create the initial local administrator. After that account exists,
the setup endpoint closes and all management access requires authentication.

### Local accounts

Administrators can add, disable, promote, demote, reset, and delete users from
the **Users** screen. Local passwords are salted and hashed with
PBKDF2-HMAC-SHA256 at 600,000 iterations. Five failed attempts lock an account
for 15 minutes.

The initial administrator is created only through this one-time setup screen;
OpenEDL does not accept bootstrap account credentials from configuration.

If the local administrator password is lost, reset it from the container:

```bash
docker compose exec openedl node openedl-cli.mjs reset-admin-password admin@example.com
```

Omit the email when the database contains exactly one local administrator. The
command prompts for the new password without echoing it, clears login lockout,
and revokes that administrator's existing sessions. For a local source
checkout, run `npm run admin:reset-password -- admin@example.com` instead.

### GUI-managed SSO

See the dedicated [SSO configuration guide](docs/SSO.md) for complete Google,
Microsoft Entra ID, custom OIDC, allowlist, proxy, rotation, and troubleshooting
instructions.

Set `CONFIG_ENCRYPTION_KEY` to a base64-encoded 32-byte key before adding SSO
providers from **SSO settings** or authenticated threat-feed API connections:

```bash
openssl rand -base64 32
```

The key remains a deployment secret. Provider client secrets entered through
the GUI are encrypted with AES-256-GCM before database storage and are never
returned by the API. Keep the key backed up; changing or losing it makes
existing GUI-managed client secrets unreadable. Environment-configured
providers remain supported and appear as read-only entries in the GUI.

### CSV uploads and paid API feeds

Choose **Add source → CSV / manual** to upload a CSV file up to 2 MB. OpenEDL
scans all cells for values matching the published list type, ignores headers
and unrelated metadata columns, and supports quoted cells containing commas.
The source remains editable after upload.

Choose **API connection** for a scheduled, authenticated feed. Generic API
connections support bearer tokens or a configurable API-key header, plus an
optional dot path such as `data.results[].entity.name` for nested JSON
responses. Credentials are encrypted with `CONFIG_ENCRYPTION_KEY`, are never
returned by the management API, and continue to use last-known-good cached data
if a refresh fails.

The **Recorded Future** preset selects the official IP, domain, or URL risk-list
endpoint for the published list type, CSV output, and `X-RFToken`
authentication. Adjust the `list` query parameter to the risk-rule machine name
included in your subscription. API response downloads have a 20 MB safety
limit. Administrators can raise the authenticated API ceiling up to 500 MB from
**Maintenance** for large licensed lists; unauthenticated remote URL limits are
independently configurable up to 100 MB.

### Storage maintenance

Administrators can open **Maintenance** to inspect the current database size,
free-page count, and immediately reclaimable SQLite space. **Run database
VACUUM** checkpoints the local write-ahead log when supported and rebuilds the
database so unused pages can be returned to disk. VACUUM can temporarily block
writes, so back up production data and run it during a quiet period. Cloudflare
D1 is managed storage and may reject manual VACUUM operations; OpenEDL reports
that backend error without changing data.

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
`MICROSOFT_OIDC_TENANT_ID`. The tenant ID must be the directory tenant UUID
from Microsoft Entra ID.

Use `AUTH_ALLOWED_DOMAINS` and/or `AUTH_ALLOWED_EMAILS` to restrict who may
manage the service after authentication.

### Scheduled refreshes

The Docker entrypoint checks for due sources every five minutes. Each source
can be set to 5, 15, or 30 minutes; hourly; every 6 or 12 hours; daily; or
weekly. External schedulers can call `POST /api/cron/refresh` with
`Authorization: Bearer $CRON_SECRET` when a stable `CRON_SECRET` is configured.

### Container logs

Follow application activity with:

```bash
docker compose logs --follow --tail 100 openedl
```

OpenEDL emits one-line structured events for container lifecycle, scheduler
runs, source configuration changes, refresh durations and entry counts,
authentication outcomes, and SSO provider changes. Credentials and source URLs
are not written to logs. Event names such as `source.refresh.failed` and
`auth.sso.failed` can be filtered directly with standard log tooling.

### Restricting the management interface by IP

Enforce an administrator IP allowlist at the reverse proxy or edge access
layer. Keep `/edl/*` public for firewalls that retrieve published lists, and
restrict every other path, including the management page, authentication
callbacks, management APIs, and static application assets. `/api/health` may
also remain public when an external health monitor requires it.

For example, a Caddy proxy can separate the public endpoints from allowed
management clients:

```caddyfile
edl.example.com {
  @public path /edl/* /api/health
  handle @public {
    reverse_proxy openedl:3000
  }

  @management remote_ip 192.0.2.10 198.51.100.0/24
  handle @management {
    reverse_proxy openedl:3000
  }

  respond 404
}
```

Replace the example addresses with the administrator egress addresses. If
another CDN or load balancer sits in front of the proxy, configure its trusted
proxy ranges before using a forwarded client IP, or apply the allowlist at that
outermost edge. Do not expose the container's port directly around the proxy.
Account email/domain allowlists remain useful as a second layer, but they do
not replace the network allowlist.

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

List creation, audit history, pagination, and richer STIX/TAXII transforms
remain for the next milestone.
