# Deploying OpenEDL to Cloudflare

Cloudflare Workers is OpenEDL's serverless deployment option. It uses:

- Workers for the application runtime
- D1 for application data and sessions
- Workers Assets for static files
- Cloudflare Images bindings for Next.js image transformations
- a Cron Trigger every five minutes for scheduled source refreshes

Docker remains the recommended option when you want portable self-hosting and
direct SQLite backups. The Cloudflare option is useful when you prefer a
managed edge runtime. The two storage backends do not synchronize.

## Prerequisites

- Node.js 24.15 or newer
- a Cloudflare account with Workers and D1 available
- this repository checked out locally

Install the locked dependencies:

```bash
npm ci
```

Authenticate Wrangler interactively:

```bash
npx wrangler login
```

For CI or other non-interactive environments, set
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` instead. See Cloudflare's
[Wrangler authentication documentation](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/).

## Create the D1 database

Create one database for the deployment:

```bash
npx wrangler d1 create openedl
```

Copy the returned `database_id`, then create your ignored deployment settings:

```bash
cp .env.cloudflare.example .env.cloudflare
```

Set at least:

```dotenv
CLOUDFLARE_WORKER_NAME=openedl
CLOUDFLARE_D1_DATABASE_NAME=openedl
CLOUDFLARE_D1_DATABASE_ID=YOUR_DATABASE_ID
```

The logical binding name remains `DB` in
`config/cloudflare-bindings.json`. Real Cloudflare resource identifiers stay
in `.env.cloudflare`, which is ignored by Git.

OpenEDL creates and upgrades its schema when the application first accesses
the database, so there is no separate production migration command.

## Configure application secrets

Create `.env.cloudflare-secrets` next to `.env.cloudflare`. It is ignored by
Git and is uploaded by the deployment command:

```dotenv
AUTH_BASE_URL=https://edl.example.com
CONFIG_ENCRYPTION_KEY=

GOOGLE_OIDC_CLIENT_ID=
GOOGLE_OIDC_CLIENT_SECRET=

MICROSOFT_OIDC_CLIENT_ID=
MICROSOFT_OIDC_CLIENT_SECRET=
MICROSOFT_OIDC_TENANT_ID=organizations

AUTH_ALLOWED_DOMAINS=example.com
AUTH_ALLOWED_EMAILS=
OIDC_PROVIDERS_JSON=[]
ADMIN_TOKEN=
```

The first visit displays a one-time administrator creation screen. Complete it
immediately after deployment, before exposing the Worker URL to other users.
Generate a GUI-managed SSO encryption key with:

```bash
openssl rand -base64 32
```

`CRON_SECRET` is only needed if an external scheduler will call
`/api/cron/refresh`. The native Cloudflare Cron Trigger invokes the refresh
handler directly.

If you use a different secrets filename, set
`CLOUDFLARE_SECRETS_FILE` in `.env.cloudflare`. If you intentionally need no
application secrets, leave that variable empty.

Cloudflare recommends secrets rather than plaintext variables for sensitive
values. See the [Workers secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/).

## Deploy

Run:

```bash
npm run deploy:cloudflare
```

The command:

1. builds the Cloudflare version of OpenEDL;
2. applies the Worker name and D1 ID from `.env.cloudflare`;
3. configures the `ASSETS`, `IMAGES`, `DB`, and Cron bindings; and
4. deploys the generated Worker with Wrangler.

The generated deployment configuration lives under `dist/` and is not
committed. The deployment does not create or require a `.openai` directory.

To inspect the deploy output without publishing:

```bash
npm run deploy:cloudflare -- --dry-run
```

## Custom domain and SSO callbacks

Add the custom domain or route in the Cloudflare dashboard after the first
deployment. Set `AUTH_BASE_URL` to the exact public HTTPS origin and deploy
again so callback URLs use the correct host.

Register these callback URLs with the applicable identity provider:

```text
https://YOUR_HOST/api/auth/callback/google
https://YOUR_HOST/api/auth/callback/microsoft
https://YOUR_HOST/api/auth/callback/CUSTOM_PROVIDER_ID
```

See the [SSO configuration guide](SSO.md) for provider-specific setup.

## Local Cloudflare development

For Workers-specific development, place local bindings and secrets in
`.dev.vars`, which is ignored by Git, then run:

```bash
npm run dev:cloudflare
```

The Cloudflare Vite plugin supplies a local D1 database through Miniflare. Use
the regular `npm run dev` command when working against the Docker/Node SQLite
adapter instead.

## Updating

Pull the new source, reinstall the locked dependencies, and redeploy:

```bash
npm ci
npm run deploy:cloudflare
```

Wrangler preserves existing secret values that are not present in the supplied
secrets file. Keep `.env.cloudflare`, `.env.cloudflare-secrets`, the D1
database, and any `CONFIG_ENCRYPTION_KEY` backup outside the Git repository.

For platform details, see Cloudflare's
[D1 guide](https://developers.cloudflare.com/d1/get-started/) and
[Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/).
