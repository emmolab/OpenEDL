# OpenEDL SSO configuration

OpenEDL supports Google, Microsoft Entra ID, and standards-compliant OpenID
Connect (OIDC) providers. Providers can be configured through the OpenEDL
administration interface or through deployment environment variables.

## Before you begin

You need:

- A public HTTPS origin for OpenEDL, such as `https://edl.example.com`.
- Administrator access to OpenEDL.
- Permission to create an OAuth or OIDC application at your identity provider.
- A client ID and client secret for a confidential web application.

Set the canonical public origin before registering any callback URLs:

```dotenv
AUTH_BASE_URL=https://edl.example.com
```

`AUTH_BASE_URL` must contain the same scheme and hostname that users enter in
their browser. OpenEDL uses it to construct callback URLs and decide whether
session cookies receive the `Secure` attribute. This is especially important
when OpenEDL runs behind a reverse proxy.

Restrict management access before enabling SSO:

```dotenv
AUTH_ALLOWED_DOMAINS=example.com
AUTH_ALLOWED_EMAILS=security-admin@example.net
```

Both values accept comma-separated entries and are case-insensitive. A user is
allowed when either their complete email address or their email domain matches.
Leaving both values empty allows any successfully authenticated account from a
configured provider.

## Callback URLs

Register an exact callback URL for each provider:

```text
https://YOUR_HOST/api/auth/callback/PROVIDER_ID
```

The built-in provider IDs produce:

```text
https://YOUR_HOST/api/auth/callback/google
https://YOUR_HOST/api/auth/callback/microsoft
```

For a custom provider with the ID `acme-sso`, use:

```text
https://YOUR_HOST/api/auth/callback/acme-sso
```

Scheme, hostname, port, path, and trailing slash behavior must match the
registered URI exactly. Do not put OpenEDL behind a proxy that rewrites the
callback path.

## Choose a configuration method

### Administration interface

This is the easiest method for most deployments. Provider client secrets are
encrypted with AES-256-GCM before being stored in the OpenEDL database.

1. Generate a stable 32-byte encryption key:

   ```bash
   openssl rand -base64 32
   ```

2. Store it in the deployment environment:

   ```dotenv
   CONFIG_ENCRYPTION_KEY=REPLACE_WITH_GENERATED_VALUE
   ```

3. Recreate the container so it receives the new environment:

   ```bash
   docker compose up -d
   ```

4. Sign in as an administrator and open **SSO settings**.
5. Select **Add provider**, choose a template, and enter the client ID and
   client secret.
6. Select **Test** to verify discovery before attempting sign-in.

Keep `CONFIG_ENCRYPTION_KEY` in a password manager or secret store. Losing or
changing it makes existing GUI-managed client secrets unreadable. If it is
lost, set a new key and re-enter the client secret for every GUI-managed
provider.

### Environment variables

Environment-defined providers are useful when secrets are managed by an
orchestrator. They appear as read-only providers in the OpenEDL interface and
take precedence over a GUI-managed provider with the same ID.

After changing provider environment variables, recreate the container:

```bash
docker compose up -d
```

Do not commit populated `.env` files, client secrets, or downloaded credential
files. OpenEDL's `.gitignore` already excludes `.env*` except `.env.example`.

## Google

Google requires an OAuth 2.0 client with the **Web application** application
type.

1. Create or select a project in Google Cloud.
2. Configure the Google Auth Platform branding and audience.
3. Create an OAuth client with the **Web application** type.
4. Add this authorized redirect URI:

   ```text
   https://YOUR_HOST/api/auth/callback/google
   ```

5. Copy the client ID and client secret.
6. Configure OpenEDL using the Google template in **SSO settings**, or set:

   ```dotenv
   GOOGLE_OIDC_CLIENT_ID=YOUR_CLIENT_ID
   GOOGLE_OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET
   ```

The configured redirect URI must exactly match the URI OpenEDL sends. Google
otherwise returns `redirect_uri_mismatch`. Google documents the current setup
process in its [OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect)
and [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

For a private Google Workspace deployment, use an internal audience where
appropriate. If the application remains in testing mode, add every intended
account as a test user.

## Microsoft Entra ID

For an internal deployment, a single-tenant app registration is the safest
default.

1. In the Microsoft Entra admin center, open **App registrations** and select
   **New registration**.
2. Select the required supported account type. Prefer accounts in your
   organizational directory only unless multi-tenant access is intentional.
3. Under **Authentication**, add the **Web** platform with:

   ```text
   https://YOUR_HOST/api/auth/callback/microsoft
   ```

4. Under **Certificates & secrets**, create a client secret. Copy the secret
   **value** when it is displayed.
5. Record the application client ID and directory tenant ID.
6. Configure OpenEDL through **SSO settings**, or set:

   ```dotenv
   MICROSOFT_OIDC_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID
   MICROSOFT_OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET_VALUE
   MICROSOFT_OIDC_TENANT_ID=YOUR_DIRECTORY_TENANT_ID
   ```

`MICROSOFT_OIDC_TENANT_ID` must be the directory tenant UUID shown in Microsoft
Entra ID. The Microsoft template in the GUI captures that tenant ID directly
and builds the tenant-specific issuer and discovery URLs automatically.

Microsoft documents app registration and web redirect configuration in its
[application registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
and [platform configuration guide](https://learn.microsoft.com/en-us/graph/auth-register-app-v2).

Do not enable the implicit grant flow. OpenEDL uses the authorization-code flow
with PKCE.

## Custom OIDC providers

The provider must expose HTTPS discovery metadata containing:

- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `jwks_uri`

It must also:

- Return an ID token from the authorization-code flow.
- Support `client_secret_post` at the token endpoint.
- Support ID tokens signed with `RS256` or `ES256`.
- Return `sub` and an email value in `email`, `preferred_username`, or `upn`.
- Accept a redirect URI based on a stable provider ID.

These metadata requirements follow the
[OpenID Connect Discovery specification](https://openid.net/specs/openid-connect-discovery-1_0.html).

In **SSO settings**, select **Custom OIDC** and enter:

- **Provider ID:** 2–32 lowercase letters, numbers, or dashes.
- **Display name:** The label shown on the sign-in screen.
- **Issuer URL:** The exact HTTPS issuer used in ID tokens.
- **Discovery URL:** Usually
  `ISSUER/.well-known/openid-configuration`.
- **Client ID** and **client secret**.
- **Scopes:** Must include `openid`; `openid profile email` is the default.

Custom providers can alternatively be configured with a single-line JSON
array:

```dotenv
OIDC_PROVIDERS_JSON=[{"id":"acme-sso","name":"Acme SSO","issuer":"https://identity.example.com","clientId":"YOUR_CLIENT_ID","clientSecret":"YOUR_CLIENT_SECRET","scopes":"openid profile email"}]
```

An optional `discoveryUrl` property overrides the default discovery location.
Each issuer and discovery URL must use HTTPS.

## Initial administrator and user provisioning

You need an administrator identity to configure providers through the GUI.
Open a new deployment and complete the one-time administrator creation screen.
Account bootstrap credentials are not accepted from environment configuration.

The setup screen and setup API close as soon as any user record exists. Complete
first-run setup before exposing a new deployment to other users. A strong
`ADMIN_TOKEN` remains useful for emergency recovery after initialization.

When an SSO account signs in for the first time, OpenEDL creates a local user
record:

- The first SSO user becomes an administrator only when no active
  administrator exists.
- Subsequent SSO users become members.
- Existing users retain their OpenEDL role on later sign-ins.
- Disabling a user in OpenEDL prevents new sessions even if the identity
  provider still authenticates them.
- SSO email addresses and credentials remain managed by the identity provider.

Use **Users** in OpenEDL to promote, demote, disable, or delete provisioned
accounts.

## Authentication behavior

OpenEDL:

- Uses the authorization-code flow with PKCE `S256`.
- Stores hashed state challenges for ten minutes.
- Validates the ID-token signature, audience, issuer, and nonce.
- Requests `openid profile email` by default.
- Rejects an explicitly unverified email claim.
- Creates HttpOnly, `SameSite=Lax` management sessions lasting 12 hours.
- Stores only a hash of each session token in the database.

## Secret rotation and recovery

### Rotate a provider client secret

1. Create a replacement secret at the identity provider.
2. Update the provider in **SSO settings**, or update the deployment
   environment variable.
3. Recreate the container when using environment variables.
4. Test the provider and complete a sign-in.
5. Revoke the old secret.

### Recover from a lost encryption key

1. Keep an existing local administrator or `ADMIN_TOKEN` available.
2. Generate and deploy a new `CONFIG_ENCRYPTION_KEY`.
3. Open **SSO settings** and re-enter every GUI-managed client secret.
4. Test each provider.

The old encrypted values cannot be recovered without the original key.

## Troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Redirect URI or reply URL mismatch | The provider callback differs from OpenEDL's callback | Check `AUTH_BASE_URL` and register the exact callback URL |
| Sign-in loops back to OpenEDL | Incorrect public origin, HTTP/HTTPS mismatch, or blocked cookie | Set the HTTPS `AUTH_BASE_URL` and verify reverse-proxy routing |
| “This account is not allowed” | The email or domain is absent from the allowlist | Update `AUTH_ALLOWED_EMAILS` or `AUTH_ALLOWED_DOMAINS` |
| Provider did not return an email | Required scopes or ID-token claims are missing | Request `openid profile email` and configure the provider to emit an email claim |
| Discovery test fails | Incorrect issuer/discovery URL or blocked outbound HTTPS | Open the discovery URL directly and verify its endpoints |
| Identity token validation fails | Wrong client ID, issuer, tenant, algorithm, or stale login attempt | Recheck provider settings and begin a new sign-in |
| Provider rejects the token exchange | Wrong secret or unsupported token endpoint authentication | Rotate the secret and confirm support for `client_secret_post` |
| Client secret cannot be decrypted | `CONFIG_ENCRYPTION_KEY` changed or was lost | Restore the original key or re-enter every provider secret |
| New SSO user is a member | An active administrator already exists | Promote the user from **Users** while signed in as an administrator |

## Final verification

Before relying exclusively on SSO:

1. Test discovery from **SSO settings**.
2. Sign in in a private browser window.
3. Confirm the expected email, name, and role.
4. Confirm an account outside the allowlist is rejected.
5. Verify that a second administrator or recovery method works.
6. Back up the OpenEDL database and `CONFIG_ENCRYPTION_KEY`.
7. Remove temporary recovery tokens that are no longer required.
