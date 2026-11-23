# Zoom Blueprint CLI guides

Start with CLI authorization, then register a reusable sample as a blueprint.

| Step | Guide | Result |
|---|---|---|
| 1 | [Create the CLI’s Marketplace app](create-cli-app.md) | A General App with public PKCE OAuth and Marketplace management scopes |
| 2 | [Sign in with public PKCE](public-pkce.md) | A browser-authorized CLI session and verified management access |
| 3 | [Register a blueprint template](register-blueprint.md) | Your sample appears in `zoom create` and can be scaffolded |

The CLI’s management app authorizes the CLI. A registered blueprint is reusable source code; `zoom create` copies it and can provision a separate Marketplace app for that generated project.

Registration and scaffold-only workflows work without a CLI login. Authorization is needed when you provision or manage a Marketplace app.

---

| Previous | Next |
| :--- | ---: |
| [← Project README](../README.md) | [Create the CLI’s Marketplace app →](create-cli-app.md) |
