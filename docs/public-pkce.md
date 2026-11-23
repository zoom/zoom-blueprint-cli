# Public PKCE login

`zoom login` authorizes Zoom Blueprint CLI to manage Marketplace apps through browser consent. Each generated sample still uses its own app credentials and authorization flow.

First complete [Create the CLI’s Marketplace app](create-cli-app.md). You will need its public client ID and registered loopback callback.

## Sign in and check access

```bash
zoom login
zoom auth status
zoom auth check --app-id <existing-marketplace-app-id>
```

Set `ZOOM_PUBLIC_CLIENT_ID` in the CLI root `.env` before signing in. Use `zoom login --env-file /path/to/.env` for another location. An exported shell value takes precedence. This ID is public; never put access or refresh tokens in project `.env` files. You can choose `--port 3000` or use `--no-browser` to copy the authorization URL into a browser manually. Close the CLI with Ctrl+C to cancel a pending sign-in.

`auth status` checks local session metadata. `auth check` performs a live manifest read and validation and reports whether a write scope appears in the grant. It does not create, update, or delete an app and does not prove write execution.

After sign-in, existing create, link, diff, validate, sync, doctor, and delete operations use the public OAuth session. Token expiry triggers refresh; the rotated refresh token is saved atomically. A failed OAuth refresh requires a new login.

```bash
zoom create --name hitl-demo --template hitl-workplace-agent
cd apps/hitl-demo
npm run install:all
zoom dev
```

HITL chatbot replies use the account ID from the signature-verified webhook. Standalone outbound sends still need a runtime `ZOOM_ACCOUNT_ID`; public-client login does not request a separate user-profile scope to retrieve it. Bot JID and Secret token remain sample-specific Marketplace settings.

## Session storage and logout

Tokens are stored in `~/.config/zoom-agent/auth/prod.json`, or under `$XDG_CONFIG_HOME/zoom-agent/auth/`. Session files use mode `0600`, and the auth directory is created with mode `0700`. `ZOOM_AUTH_DIR` overrides this location for isolated testing. CLI processes serialize refresh/logout to avoid consuming a rotating refresh token twice.

```bash
zoom logout
```

Logout attempts to revoke the token and always removes the local session. If revocation cannot be confirmed, the CLI reports that separately. Never commit the auth directory, tokens, or sample `.env` files.

`--env prod` is the commercial Marketplace, including its Development tab. Internal sandbox hosts are not exposed by this CLI. Zoom for Government uses the documented manual workflow.

## Management authentication

Marketplace operations require `zoom login`. Generated apps keep their own runtime credentials; those credentials are never used to authenticate CLI management operations.

See [Zoom PKCE documentation](https://developers.zoom.us/docs/integrations/PKCE/) and the [Marketplace Apps API](https://developers.zoom.us/docs/api/marketplace/).

---

| Previous | Next |
| :--- | ---: |
| [← Create the CLI’s Marketplace app](create-cli-app.md) | [Register a blueprint template →](register-blueprint.md) |
