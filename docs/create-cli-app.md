# Create the CLI’s Marketplace app

Register one General App to let Zoom Blueprint CLI manage Marketplace apps through public-client PKCE OAuth. Developers can then sign in through the browser without a management client secret.

## 1. Create a General App

Sign in to [Zoom Marketplace](https://marketplace.zoom.us/), open **Develop → Build App**, and choose **General App**. Name it **Zoom Blueprint CLI App Manager**.

For managing your own apps, start with **User-managed**. Under **Scopes**, add:

| Scope | Purpose |
|---|---|
| `marketplace:read:app` | Read and validate app manifests |
| `marketplace:write:app` | Create, update, and delete apps |

Account-wide management requires the appropriate admin-managed configuration, admin scope variants, and account permissions. Public-client admin authorization has not been live verified in this project.

## 2. Enable public PKCE OAuth

In **Basic Information → App Credentials**, enable **Use public client OAuth**. Copy the **public client ID**. This is different from the confidential client ID; the public flow does not use a client secret.

## 3. Configure the public-client callback

Set **PKCE OAuth Redirect URL** to:

```text
http://127.0.0.1:3000/callback
```

Add the same URI to **OAuth allow lists**. Configure the public client’s redirect field, not only the confidential client’s **OAuth redirect URL**.

Zoom ignores the port for eligible loopback redirects, so the CLI normally chooses an available port. The scheme, numeric host, and path must match. Use `127.0.0.1`, not `localhost`. 

## 4. Complete setup for testing

Complete the required developer information and local-test requirements in Marketplace. The consenting user must have permission to manage the target apps. Distribution outside your account requires the applicable Marketplace approval and distribution setup; enabling PKCE alone does not make an app publicly available.

Keep the public client ID available for the next guide. Do not copy the confidential client secret into the CLI or your generated projects for this login flow.

Set `ZOOM_PUBLIC_CLIENT_ID` in the CLI root `.env`.

See [Zoom’s PKCE documentation](https://developers.zoom.us/docs/integrations/PKCE/) and the [Marketplace Apps API](https://developers.zoom.us/docs/api/marketplace/).

---

| Previous | Next |
| :--- | ---: |
| [← Guides](README.md) | [Sign in with public PKCE →](public-pkce.md) |
