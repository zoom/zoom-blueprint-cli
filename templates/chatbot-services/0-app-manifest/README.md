# Marketplace manifest

The canonical app configuration is [app-manifest.json](app-manifest.json). Zoom Blueprint CLI uses it during creation and updates the development URL fields through zoom dev.

From the generated project, run zoom app validate for local and available remote checks. Run zoom app diff --url https://your-dev-host.example to preview changes. Use zoom app link --app-id YOUR_APP_ID to connect an existing General App.

Keep the CLI's management credentials separate from the app's runtime credentials. Complete any Development → Local Test requirements and authorize the development app before testing it in Zoom.

See [the sample setup guide](../README.md) for installation, configuration, and a first interaction.


## Placeholder convention

- `{{APP_NAME}}` is the project's display name.
- `{{DEV_BASE_URL}}` is the public HTTPS origin, with no trailing slash.
- `{{DEV_HOSTNAME}}` is that origin's hostname, without a scheme or path.

Callbacks append /auth/callback, and webhook endpoints append /webhooks. Zoom Chat uses /webview for its home page; the other samples use /.

The CLI substitutes a bootstrap origin before creation and uses the live development origin during zoom dev or zoom app sync. Domain allow-list entries receive the hostname. Use the CLI to resolve the manifest before submitting it to Marketplace. Production fields remain separate deployment settings.
