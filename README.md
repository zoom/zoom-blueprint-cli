# Zoom Blueprint CLI

Zoom Blueprint CLI scaffolds Zoom application samples, provisions Marketplace General Apps, and synchronizes local development URLs.

Build a Zoom Chat bot, explore human approvals with meeting capture, or create a Contact Center app. Provider and product support varies by template; Video SDK Blueprints are not currently supported.

## Requirements

- Node.js 22.23.5 (the currently verified version).
- A Zoom developer account with access to the features used by your template.
- An [ngrok](https://ngrok.com/) authentication token, or an existing public HTTPS endpoint.

## Setup

From the repository root, install and build the CLI:

```bash
npm ci
npm run build
npm link
```

### Sign in with public PKCE

Register the CLI’s General App using the [Marketplace app setup guide](docs/create-cli-app.md). Copy [.env.example](.env.example) to the CLI root `.env` and set:

```dotenv
ZOOM_PUBLIC_CLIENT_ID=your_public_client_id
NGROK_AUTHTOKEN=your_ngrok_token
```

The ngrok token is needed only for automatic tunneling. Keep `.env` out of version control; use a managed secrets service and environment injection for deployments or shared automation. Saved PKCE sessions stay in the CLI’s protected local auth store. Then sign in:

```bash
zoom login
zoom auth status
zoom auth check --app-id <existing-app-id>
```

Login uses browser consent and a loopback callback. 

### Marketplace permissions

The CLI’s public-client General App needs these scopes:

| Scope | Purpose |
|---|---|
| `marketplace:read:app` | Read app configuration and validate manifests |
| `marketplace:write:app` | Create, update, and delete Marketplace apps |

Browser login is optional for scaffold-only projects (`--no-create`).

## Quick start

Choose one template to create an app:

```bash
zoom create --name chat-demo --template chat-ai-assistant
zoom create --name hitl-demo --template hitl-workplace-agent
zoom create --name contact-center-demo --template zcc-nextjs-sample
```

Enter the generated project and start development (Chat example):

```bash
cd apps/chat-demo
npm install
zoom dev
```

Follow the terminal guidance to complete setup, review Marketplace URL changes, and test in Zoom. For local scaffolding only, add `--no-create` to the create command and run `zoom dev --no-sync`.

For detailed logs, use `zoom dev --verbose`. To use your own HTTPS endpoint, run `zoom dev --url https://your-dev-host.example`.

### Create options

Example with explicit options:

```bash
zoom create --name chat-demo --template chat-ai-assistant \
  --app-type general --provider anthropic --out-dir ./apps \
  --env prod --env-file .env --verbose
```

| Option | Purpose |
|---|---|
| `[project-name]`, `-n, --name <name>` | Set the project name |
| `--template <id>` | Select a template from the table below |
| `-t, --app-type <type>` | Use `general` for all bundled templates |
| `-p, --provider <provider>` | Check fixed-provider compatibility: `anthropic` for the Chat template; not a provider switch for HITL or Contact Center |
| `-o, --out-dir <dir>`, `--output <dir>` | Set the parent directory; default `./apps` |
| `-e, --env <env>` | Use `prod`, the commercial Marketplace host |
| `--env-file <path>` | Load CLI configuration from a file; default `./.env` |
| `--no-create` | Scaffold without creating a Marketplace app |
| `-y, --yes` | Use supplied flags and defaults without interactive prompts |
| `--verbose` | Show detailed setup diagnostics |
| `--claude-code` | Generate customization instructions and a Git branch for Claude Code |
| `--branch <name>` | Set the customization branch name; default `customize`; used with `--claude-code` |
| `-h, --help` | Show command help |

Use `--env prod` for the commercial Marketplace, including its Development tab. Internal sandbox hosts are not part of the public CLI. 

## Templates

| Template | Demonstrates | Install dependencies |
|---|---|---|
| [chat-ai-assistant](templates/chatbot-services/README.md) | Zoom Chat research bot with Claude | `npm install` |
| [hitl-workplace-agent](templates/hitl-workplace-agent/README.md) | RTMS meeting capture, AI recommendations, and human approvals with OpenAI and Claude | `npm run install:all` |
| [zcc-nextjs-sample](templates/zcc-nextjs-sample/README.md) | Contact Center engagement context and status with the Zoom Apps SDK | `npm install` |

See each template README for permissions, environment variables, and testing. AI keys can be added after local setup; Contact Center does not require them.

## Register your own sample

Register a local sample folder, then create projects from its saved snapshot:

```bash
zoom blueprint register ./my-sample
zoom create --name my-demo --template my-sample
```

See the [blueprint registration guide](docs/register-blueprint.md) for sample requirements and reusable definitions.

## Commands

| Command | Description |
|---|---|
| `zoom login` | Sign in using public-client PKCE OAuth |
| `zoom logout` | Revoke the public OAuth token and remove local login |
| `zoom auth status` | Inspect local login status |
| `zoom auth check --app-id <id>` | Verify live manifest read/validation access without changing an app |
| `zoom blueprint register <folder>` | Validate and save a local sample snapshot |
| `zoom blueprint list` | List bundled and registered blueprints |
| `zoom blueprint inspect <id>` | Inspect a blueprint; use `--json` to export its definition |
| `zoom blueprint unregister <id>` | Remove a local registration; preserve generated projects |
| `zoom create` | Create a project and Marketplace app |
| `zoom dev` | Start local development and review URL synchronization |
| `zoom configure` | Enter and validate missing project configuration |
| `zoom app create` | Finish provisioning an existing scaffold |
| `zoom app link --app-id <id>` | Link an existing Marketplace app |
| `zoom app validate` | Validate the project manifest with Zoom |
| `zoom app diff` | Preview Marketplace configuration changes |
| `zoom app sync` | Apply Marketplace configuration changes |
| `zoom app delete` | Delete the linked Marketplace app; preserve local files |
| `zoom project delete` | Delete the local project directory; preserve the Marketplace app |
| `zoom doctor` | Check project configuration and health |

Run `zoom <command> --help` for options.

## Guides

- [Create the CLI’s Marketplace app](docs/create-cli-app.md)
- [Sign in with public PKCE](docs/public-pkce.md)
- [Register a blueprint template](docs/register-blueprint.md)

## Zoom for Government

[Zoom for Government](https://www.zoomgov.com/) uses separate Marketplace and API hosts. Create your app in the [Government Marketplace](https://marketplace.zoomgov.com/), use its credentials, and register your redirect URI there.

| Surface | Commercial Zoom | Zoom for Government |
|---|---|---|
| Marketplace | `marketplace.zoom.us` | `marketplace.zoomgov.com` |
| API base | `https://api.zoom.us/v2` | `https://api.zoomgov.com/v2` |
| OAuth base | `https://zoom.us` | `https://zoomgov.com` |

The templates accept these runtime overrides in the generated project's `.env`:

```dotenv
ZOOM_API_BASE_URL=https://api.zoomgov.com/v2
ZOOM_OAUTH_BASE_URL=https://zoomgov.com
```

These overrides do not change the CLI's Marketplace management host. Automated Government Marketplace provisioning and synchronization are not supported. Scaffold with `--no-create`, configure your Government app manually, and run `zoom dev --no-sync`. Confirm the template's product features are available in your Government account before testing.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Need help?

- [Developer Support](https://developers.zoom.us/support/) — Technical support
- [Developer Forum](https://devforum.zoom.us) — Community discussions
- [Premier Developer Support](https://www.zoom.com/en/support-plans/developer/) — Priority support plans

## License

MIT License — See [LICENSE](./LICENSE) for details.
