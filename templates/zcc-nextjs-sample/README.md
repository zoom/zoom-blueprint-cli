# Zoom Contact Center Engagement Explorer

A Next.js frontend that uses the Zoom Apps SDK to display engagement context and status inside Zoom Contact Center.

## Before you start

- Use Node.js 22.23.5 (verified) and npm.
- Have access to a licensed Zoom Contact Center account and the Zoom desktop app.
- Have a Contact Center admin available to assign the app to a test queue.
- Prepare a way to receive a test engagement in that queue. Voice testing requires the account's voice setup.

The app reads SITE_URL for its public origin. Browser authorization uses the General App’s ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, and ZOOM_REDIRECT_URI. The CLI fills credentials when it provisions the app and keeps the redirect URL synchronized. It has no LLM integration. Run `zoom login` to authorize CLI Marketplace provisioning and synchronization with public PKCE.

## 1. Create a project

From your CLI workspace, run the interactive command.

```bash
zoom create --name contact-center-demo --template zcc-nextjs-sample
cd apps/contact-center-demo
npm install
```

The CLI creates .env from .env.example and prints the direct link to the created Marketplace app. Keep the existing .env when resuming setup.

To explore the source before provisioning a Marketplace app, add --no-create --yes to the create command. From that generated project, run zoom dev --no-sync. To connect an existing General App later, run the following command. In Marketplace Development, copy that app’s Client ID and Client Secret into ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET in .env, then continue with normal zoom dev.

```bash
zoom app link --app-id YOUR_APP_ID
```

Run zoom login once to authorize CLI management operations. The generated app uses separate runtime credentials.

## 2. Start local development

For an ngrok tunnel, set NGROK_AUTHTOKEN in the CLI root .env.

```bash
zoom dev
```

The CLI starts Next.js on port 3000, updates SITE_URL, and offers to synchronize the development home and OAuth callback URLs to the linked Marketplace app. Review and accept the proposed changes.

For an existing public HTTPS endpoint that routes to local port 3000, run the following command.

```bash
zoom dev --url https://your-dev-host.example
```

Keep zoom dev running while testing. Running npm run dev alone starts Next.js without managing a tunnel or synchronizing Marketplace settings.

## 3. Authorize in your browser and open Zoom

Open the public URL printed by zoom dev. Click **Authorize and open in Zoom**, approve Zoom’s consent screen, and then click **Open in Zoom**. Allow the browser to open the Zoom desktop app.

The sample exchanges the authorization code on the server and uses Zoom’s deep-link API. Provider tokens and the app secret stay on the server. This browser flow can add the app through OAuth, subject to your account’s app approval and development eligibility policies.

If the browser flow cannot authorize the app, open the app-specific Marketplace link printed by the CLI and review Development → Local Test requirements. A Contact Center admin must assign the app to the test queue before engagement features are available.

See [Zoom OAuth authorization](https://developers.zoom.us/docs/integrations/end-user-auth/) and [Zoom deep links](https://developers.zoom.us/docs/api/marketplace/).

## 4. Verify an engagement

In the Zoom desktop app, handle an engagement from the configured queue and open the app. Confirm that engagement context and status appear, then change the engagement status and observe the update.

Opening the public URL in a normal browser displays the authorization and launch page. To test SDK context and events, open the app inside an active Contact Center engagement. See [Contact Center apps](https://developers.zoom.us/docs/contact-center/apps/).

## Resume or troubleshoot

- If the app is not available during an engagement, confirm that it was added and assigned to the engagement's queue.
- If ngrok changes its hostname, restart zoom dev and accept the new URL sync.
- Run zoom doctor to inspect local configuration and available Marketplace checks. These checks do not confirm queue assignment or an actual SDK event.
- Use zoom app diff --url https://your-dev-host.example to preview Marketplace differences.
- See [the bundled manifest](0-app-manifest/README.md) for the app's configuration.

## License

[MIT](LICENSE).

The manifest uses zoomapp:inmeeting for the Zoom App launch flow. The CLI validates manifests through Zoom’s Marketplace validation API. A successful validation checks the manifest structure and scopes; complete browser consent and desktop launch to verify account-specific behavior.

## Explore the in-Zoom home page

The home page shows engagement details, the latest 30 SDK activity entries, and guided actions. Expand View SDK response to inspect the received payloads. The always-visible engagement workspace saves notes and form values locally per engagement, shows save feedback, and clears them when an end event arrives. A waiting state explains how to start an engagement, while an SDK connection error offers a retry action.

## Dependency security

This sample stays on Next.js 15. Its package overrides pin patched PostCSS and Sharp versions because this Next.js line still references older transitive versions. Keep these overrides until a tested Next.js update supplies patched dependencies itself. Use Node.js 22.23.5 (verified) for the verified development environment and native image dependency.


## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SITE_URL` | Yes | Public HTTPS app origin; set by `zoom dev` |
| `ZOOM_CLIENT_ID` | Yes | Generated General App’s development Client ID |
| `ZOOM_CLIENT_SECRET` | Yes | Generated General App’s development client secret; server only |
| `ZOOM_REDIRECT_URI` | Yes for authorization | OAuth callback matching the Marketplace allow list; set by `zoom dev` |
| `PORT` | No | Local Next.js port; default 3000 |
| `ZOOM_API_BASE_URL` | No | REST host override; default `https://api.zoom.us/v2` |
| `ZOOM_OAUTH_BASE_URL` | No | OAuth host override; default `https://zoom.us` |

## Development defaults and production deployment

This is an exploration sample, not a production Contact Center integration. SDK engagement context requires an active engagement in the Zoom client; browser previews do not verify real SDK events, licenses, or queue assignment.

Keep `.env` for local development. For deployment, inject the client secret and other credentials through a managed secrets service. Review OAuth state/cookie behavior, CSP and allowed origins, tenant authorization, logging, rate limits, and retention before exposing real customer data. The UI includes illustrative local fields and activity; those are not a durable Contact Center system of record.

## Zoom for Government

Where the required Contact Center features are available, create the app in the Government Marketplace and set these runtime overrides:

```dotenv
ZOOM_API_BASE_URL=https://api.zoomgov.com/v2
ZOOM_OAUTH_BASE_URL=https://zoomgov.com
```

Scaffold with `--no-create`, configure the Government app manually, and run `zoom dev --no-sync`. CLI Government provisioning is unsupported. Confirm product availability and approval requirements with your account team; this sample’s Government authorization and engagement flow has not been live verified.
