# Contact Center Marketplace manifest

The canonical configuration is [app-manifest.json](app-manifest.json). It enables the Contact Center surface and the Zoom Apps SDK APIs used by this sample.

Zoom Blueprint CLI uses this manifest during app creation. After a tunnel or custom HTTPS URL is available, zoom dev updates the development home URL and the app-domain allow-list entry. The SDK domain remains in the allow list.

From the generated project, run these commands to inspect the configuration.

```bash
zoom app validate
zoom app diff --url https://your-dev-host.example
```

Use zoom app link --app-id YOUR_APP_ID to associate an existing General App. Run zoom login to authorize remote validation and synchronization with public PKCE. The browser flow uses the app credentials and ZOOM_REDIRECT_URI on the server; SITE_URL is the public origin.

After synchronization, open the public URL and click Authorize and open in Zoom. The General App requests zoomapp:inmeeting, as in Zoom’s Contact Center quickstart, and generates the launch link with the authorized user token. The legacy app:deeplink:write scope must not be added to the USER_OPERATION manifest. Development eligibility and account approval still apply. A Contact Center admin must assign the app to the test queue. Use the Marketplace link to resolve any Development → Local Test requirements.

See the [sample setup guide](../README.md) for the complete onboarding flow.


## Placeholder convention

- `{{APP_NAME}}` is the project's display name.
- `{{DEV_BASE_URL}}` is the public HTTPS origin, with no trailing slash.
- `{{DEV_HOSTNAME}}` is that origin's hostname, without a scheme or path.

Callbacks append /auth/callback, and webhook endpoints append /webhooks. Zoom Chat uses /webview for its home page; the other samples use /.

The CLI substitutes a bootstrap origin before creation and uses the live development origin during zoom dev or zoom app sync. Domain allow-list entries receive the hostname. Use the CLI to resolve the manifest before submitting it to Marketplace. Production fields remain separate deployment settings.
