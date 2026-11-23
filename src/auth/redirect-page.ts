export type AuthorizationPageState = 'received' | 'declined' | 'invalid';

/** Browser handoff only: the terminal, not this page, confirms a successful token exchange. */
export function renderAuthorizationPage(state: AuthorizationPageState, nonce: string): string {
  const received = state === 'received';
  const title = received ? 'Authorization received' : state === 'declined' ? 'Sign-in was cancelled' : 'This sign-in link is invalid';
  const message = received
    ? 'Return to your terminal to finish connecting Zoom Blueprint CLI.'
    : 'Return to your terminal and run zoom login to start a new sign-in.';
  const detail = received
    ? 'The CLI will securely exchange the authorization code and confirm when you are signed in. Check your terminal for the final result.'
    : 'No new CLI login was saved from this response. Your existing Zoom apps have not been changed.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Zoom Blueprint CLI</title>
<style nonce="${nonce}">
:root{font-family:Arial,Helvetica,sans-serif;color:#17233b;background:#f5f8ff;color-scheme:light}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% 0,#e6efff,transparent 65%),#f7f9fd}
header{height:84px;display:flex;align-items:center;gap:24px;padding:0 40px;border-bottom:1px solid #e0e7f2;background:#ffffffc9}
.wordmark{font-size:42px;line-height:1;letter-spacing:-2.5px;font-weight:700;color:#0b5cff}.brand{border-left:1px solid #dce3ee;padding-left:24px;font-size:15px;font-weight:600;color:#46556f}
main{max-width:660px;margin:0 auto;padding:72px 24px 40px}.card{background:white;border:1px solid #dce5f2;border-radius:24px;box-shadow:0 18px 70px #153c7910;overflow:hidden}
.accent{height:5px;background:#0b5cff}.content{padding:40px}.status-icon{display:grid;place-items:center;width:56px;height:56px;margin-bottom:26px;border-radius:50%;background:${received ? '#e9f6ee' : '#fff1e8'};color:${received ? '#16743e' : '#9a4d13'};font-size:29px;font-weight:600}
.eyebrow{text-transform:uppercase;letter-spacing:1.6px;font-size:11px;font-weight:700;color:#566681;margin:0 0 14px}h1{font-size:32px;line-height:1.15;letter-spacing:-.7px;margin:0 0 18px}p{font-size:16px;line-height:1.6;margin:0;color:#526078}.lead{font-size:19px;color:#344560;line-height:1.5}
.next{margin-top:30px;border:1px solid #d9e6ff;background:#f4f8ff;border-radius:14px;padding:22px}.next-title{font-size:15px;color:#173d75;font-weight:700;margin-bottom:9px}.next p{font-size:14px;line-height:1.6}.terminal{display:inline-block;margin-top:16px;padding:9px 12px;border-radius:7px;background:#142844;color:white;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px}
footer{text-align:center;padding:24px 12px;color:#68758b;font-size:13px;line-height:1.6}.context{display:flex;align-items:center;gap:8px;margin-top:25px;color:#69758a;font-size:12px}.dot{width:6px;height:6px;background:#0b5cff;border-radius:50%}
@media(max-width:540px){header{height:72px;padding:0 22px;gap:16px}.wordmark{font-size:35px}.brand{padding-left:16px;font-size:13px}main{padding:36px 16px 24px}.content{padding:28px 24px}h1{font-size:27px}.lead{font-size:17px}.next{padding:18px}}
@media(prefers-reduced-motion:no-preference){.card{animation:appear .25s ease-out}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}}
</style></head><body>
<header><span class="wordmark" aria-label="Zoom">zoom</span><span class="brand">Blueprint CLI</span></header>
<main><section class="card" aria-labelledby="title"><div class="accent"></div><div class="content">
<div class="status-icon" aria-hidden="true">${received ? '✓' : '!'}</div>
<p class="eyebrow">Developer sign-in</p><h1 id="title">${title}</h1><p class="lead">${message}</p>
<div class="next"><div class="next-title">${received ? 'Continue in your terminal' : 'Start a new sign-in'}</div><p>${detail}</p>${received ? '' : '<code class="terminal">zoom login</code>'}</div>
<div class="context"><span class="dot" aria-hidden="true"></span>Zoom Blueprint CLI · Browser authorization</div>
</div></section><footer>You can close this tab and return to the terminal where you started sign-in.</footer></main>
<script nonce="${nonce}">history.replaceState(null,'','/complete');</script>
</body></html>`;
}
