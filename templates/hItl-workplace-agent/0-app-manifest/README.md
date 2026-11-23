# Marketplace manifest

[`app-manifest.json`](app-manifest.json) is the canonical General App configuration for this sample. It declares Zoom Apps, Zoom Chat, RTMS, OAuth, and the sample’s required scopes.

## Create or link the app

From a generated project, finish Marketplace creation with:

```bash
zoom login
zoom app create
zoom dev
```

If you already have an app, use `zoom app link --app-id <id>` instead of creating another one. CLI login manages Marketplace configuration; the sample uses its own OAuth credentials in `.env`.

## Inspect configuration changes

```bash
zoom app validate
zoom app diff --url https://your-development-host.example
```

`zoom dev` resolves the public development URL and guides synchronization. Keep `NGROK_AUTHTOKEN` in CLI/global configuration. The sample `.env` needs only its runtime configuration.

The template uses `{{APP_NAME}}`, `{{DEV_BASE_URL}}`, and `{{CHAT_COMMAND}}` placeholders. The CLI replaces these as appropriate. Preserve required Zoom SDK domains. The slash-command word stays a word; its separate webhook endpoint uses the public URL.

## Complete Zoom Chat setup

Open your app’s Marketplace editor using the app ID saved in `.zoom-agent.json`:

```text
https://marketplace.zoom.us/develop/applications/<app-id>/information
```

- **Features → Surface → Chat subscription:** copy **Bot JID** into `ZOOM_BOT_JID`.
- **Features → Access → Token:** copy **Secret token** into `ZOOM_VERIFICATION_TOKEN`.

The CLI prints direct links to these settings when they are needed. Live RTMS additionally requires account enablement and a test meeting. See the [sample README](../README.md) for the approval workflow and feature-specific AI keys.

---

| Previous | Next |
| :--- | ---: |
| [← Sample README](../README.md) | [Inspect the manifest →](app-manifest.json) |


## Scope coverage

| Feature | Scopes |
|---|---|
| Bot replies and Zoom Chat SDK actions | `imchat:userapp`, `team_chat:read:user_message`, `app:channel_content:write` |
| Verified operator identity | `user:read:user` |
| Meeting context and in-client RTMS controls | `meeting:read:meeting`, `zoomapp:inmeeting`, `meeting:update:participant_rtms_app_status` |
| Transcript capture and lifecycle events | `meeting:read:meeting_transcript`, `rtms:read:rtms_started`, `rtms:read:rtms_stopped`, `rtms:read:rtms_interrupted` |
| Optional Zoom Doc creation through MCP | `docs:write:import` |

Audio, video, screenshare, ZCC voice, recording search/content, broad document export, and AI Companion search permissions are not requested. Live Zoom Tasks access is not configured by this manifest; local approval/task storage remains available without it.

The current General App validation API rejects the legacy `imchat:bot` scope name. This manifest uses `imchat:userapp` with Chat subscription enabled, as verified against Zoom.
