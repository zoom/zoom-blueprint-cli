# Register a blueprint template

A blueprint is a reusable application sample selected by `zoom create`. Register a local folder once, then create independent projects from its saved snapshot. Registration does not create a Marketplace app, install dependencies, or execute sample code. You do not need `zoom login` to register or scaffold a blueprint.

## 1. Prepare a local sample

Clone your repository anywhere outside the CLI installation:

```bash
git clone https://github.com/your-org/your-sample.git ./my-sample
```

The folder needs:

```text
my-sample/
├── package.json
├── .env.example
├── README.md
├── 0-app-manifest/
│   └── app-manifest.json
└── ...application source
```

Provide a working development script in `package.json`. The manifest must describe a General App and its actual OAuth scopes. Declare runtime settings in `.env.example`; keep CLI configuration such as `ZOOM_PUBLIC_CLIENT_ID` and `NGROK_AUTHTOKEN` in the CLI’s `.env`.

Use these placeholders where appropriate:

| Placeholder | Purpose |
|---|---|
| `{{APP_NAME}}` | Generated app display name |
| `{{DEV_BASE_URL}}` | Public HTTPS origin; append routes such as `/auth/callback` |
| `{{CHAT_COMMAND}}` | Project-specific slash-command word |
| `{{DEV_HOSTNAME}}` | Hostname only, where required by the manifest |

Keep required SDK domains such as `appssdk.zoom.us`. They are not tunnel URLs, and slash-command words are not URL fields. Preserve the sample’s license and attribution.

## 2. Register the folder

```bash
zoom blueprint register ./my-sample
```

If the folder has no `zoom-blueprint.json`, the CLI guides you through:

- A unique blueprint ID, display name, and description.
- The manifest location, development script, and installation command.
- Local port, its environment variable, and the readiness endpoint. For split apps, select the public frontend’s port variable.
- Required runtime values; leave optional integrations unchecked.
- Marketplace URL fields and environment values that should follow the development URL.

The CLI detects common manifest locations and package scripts, then asks you to confirm its suggestions. It reads scopes from the manifest. It does not infer AI support from installed SDKs.

Review the summary and confirm registration. The original folder is unchanged. By default, snapshots are stored under `~/.config/zoom-agent/blueprints/<id>/`; `$XDG_CONFIG_HOME` is respected. `ZOOM_BLUEPRINT_DIR` can select another catalog for testing or a separate workspace.

Registration excludes Git history, dependency/build folders, private `.env` files, `.npmrc`, credential files, and common private-key files. Safe `.env.example` and `.env.<name>.example` files are retained. Symbolic links in copied content are rejected. Review the remaining source and examples for embedded secrets before registering; filename exclusions cannot identify every secret.

## 3. Inspect and create a project

```bash
zoom blueprint list
zoom blueprint inspect my-sample
zoom create --name my-demo --template my-sample --no-create --yes
cd apps/my-demo
npm install
zoom dev --no-sync
```

Use the installation command printed by your blueprint if it differs from `npm install`.

Registered blueprints also appear in the interactive `zoom create` menu and `zoom create --help`. Inspecting a registration shows its original folder, registration date, and snapshot SHA-256 fingerprint.

`--no-create` scaffolds without creating a Marketplace app. To provision a new app afterward, run `zoom login` and then `zoom app create` from the generated project. For an existing app, use `zoom app link --app-id <id>`. Review proposed Marketplace changes with `zoom app diff` before synchronizing.

## 4. Save a reusable definition

Export the guided configuration to your sample repository:

```bash
zoom blueprint inspect my-sample --json > ./my-sample/zoom-blueprint.json
```

Review and commit that file with the source. Another developer can then register the folder without repeating the wizard:

```bash
zoom blueprint register ./my-sample --yes
```

`--yes` requires a valid, complete definition and skips confirmation. It does not supply missing runtime details. A minimal Node.js sample definition looks like this:

```json
{
  "schemaVersion": 1,
  "id": "my-sample",
  "name": "My Zoom Sample",
  "description": "Demonstrates browser authorization and a Zoom API request.",
  "manifestPath": "0-app-manifest/app-manifest.json",
  "requiredEnv": ["ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"],
  "setupCommands": ["npm install"],
  "startCommands": ["npm run dev"],
  "runtime": {
    "kind": "server",
    "devCommand": ["npm", "run", "dev"],
    "dependencyDirs": ["."],
    "portEnv": "PORT",
    "defaultPort": 3000,
    "readinessPath": "/health",
    "urlMappings": [
      {
        "path": "oauth_information.development_redirect_uri",
        "route": "/auth/callback",
        "label": "OAuth callback"
      },
      {
        "path": "oauth_information.oauth_allow_list.0",
        "route": "/auth/callback",
        "label": "OAuth allow list"
      }
    ]
  },
  "reconcile": {
    "urlVars": [
      { "name": "ZOOM_REDIRECT_URI", "route": "/auth/callback", "label": "OAuth callback" }
    ]
  }
}
```

Adapt the routes and required values to the actual app. Every mapped path must exist as a string in the manifest. Every declared environment variable must appear in `.env.example`. This example also needs `PORT` and `ZOOM_REDIRECT_URI` there.

### Additional configuration

Definitions reuse the CLI’s template metadata contract (`Template` in `src/templates/registry.ts`) rather than a separate provisioning system. Do not include `source` or `compatibleAppTypes`: registration supplies the local snapshot source, and supported apps are General Apps.

| Field | When to use it |
|---|---|
| `sourceRepo`, `sourceRef` | Record the upstream repository and reviewed commit/tag |
| `requiredScopes` | Derived from the manifest; a nonempty explicit list must match its scope set exactly |
| `runtime.dependencyDirs` | List package folders such as `[".", "backend", "frontend"]` for dependency checks |
| `runtime.testInstructions` | Explain the user action that verifies the sample in Zoom |
| `reconcile.urlVars` | Refresh runtime URLs when the tunnel changes; use `kind: "origin"` for an origin without a route |
| `reconcile.generateVars` | Generate secrets such as `SESSION_SECRET` when missing |
| `reconcile.promptVars` | Guide manual values, with `marketplacePage: "surface"` or `"access"` for direct app links |
| `supportedSurfaces`, `requiredCapabilities`, `setupNotes` | Describe the sample’s product features and setup needs |
| `supportedProviders`, `aiMode`, `aiFeatures`, `providerIntegration` | Declare actual OpenAI/Anthropic implementations; do not advertise a provider switch the sample does not implement |

For example, a bot prompt can use `name: "ZOOM_BOT_JID"`, `label: "Bot JID"`, `validate: "botJid"`, and `marketplacePage: "surface"`. Secret-token prompts use `validate: "secretToken"` and `marketplacePage: "access"`. Add matching variables to `.env.example`.

AI defaults to `aiMode: "none"`, with no providers or features. For implemented AI, set `providerIntegration: "sample-native"`; use `aiMode: "fixed"` for one provider or `"feature-specific"` for feature routing. Each `aiFeatures` entry needs `name`, `provider`, `keyEnv`, `modelEnv`, and `defaultModel`. Registration validates metadata consistency; it does not prove that the sample’s inference code works.

Commands are recorded during registration and executed only when you follow setup instructions or run `zoom dev`. Review them before running an unfamiliar blueprint.

## 5. Update or remove a registration

Source-folder edits do not change a saved registration. After changing a sample or its definition, replace the snapshot explicitly:

```bash
zoom blueprint unregister my-sample
zoom blueprint register ./my-sample
```

For automation, add `--yes` to both commands after reviewing the definition. Existing IDs are never silently overwritten, and bundled IDs cannot be replaced or unregistered.

Unregistering removes only the saved registration. Generated project files and Marketplace apps remain. Generated projects retain their blueprint metadata, so `zoom dev`, `zoom configure`, and app commands continue to use the configuration captured at creation, including on another machine. Source updates apply only to newly generated projects.

Direct repository URL registration is not supported in this version: clone first, then register the local folder. Publishing a sample repository with `zoom-blueprint.json` makes it shareable; registering it does not add it to the CLI’s bundled catalog or publish an npm package.

---

| Previous | Next |
| :--- | ---: |
| [← Sign in with public PKCE](public-pkce.md) | [Guides index →](README.md) |
