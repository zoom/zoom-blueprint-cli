import { headers } from 'next/headers';
import ZoomApp from '@/components/zoomapp-sdk/zoom-app';

export default async function Page() {
  const requestHeaders = await headers();
  if (requestHeaders.has('x-zoom-app-device-type')) return <ZoomApp />;
  return (
    <div>
      <section className="zcc-welcome">
        <div>
          <p className="zcc-eyebrow">Contact Center · Engagement Explorer</p>
          <h1>Explore an engagement.<br />See what you can build.</h1>
          <p className="zcc-lead">Connect this sample to your Zoom account, then open it in Zoom Workplace to explore Contact Center engagement context and status.</p>
          <a className="zcc-button" href="/auth/login">Authorize and open in Zoom <span aria-hidden="true">→</span></a>
          <p className="zcc-small zcc-action-note">You’ll review permissions on Zoom before returning here.<br />Keep your development server running.</p>
        </div>
        <aside className="zcc-demo" aria-label="What this sample demonstrates">
          <div className="zcc-demo-title">Inside the sample <span className="zcc-preview-label">What you’ll explore</span></div>
          <div className="zcc-demo-row"><span className="zcc-number">1</span><div><h2>Engagement context</h2><p>Inspect the current engagement ID and the context available to your app.</p></div></div>
          <div className="zcc-demo-row"><span className="zcc-number">2</span><div><h2>Live status changes</h2><p>See how your app responds as an engagement’s status changes.</p></div></div>
          <div className="zcc-demo-row"><span className="zcc-number">3</span><div><h2>A starting point for your workflow</h2><p>Explore the SDK events you could use to build agent tools and contextual experiences.</p></div></div>
        </aside>
      </section>
      <section className="zcc-steps" aria-label="Your next steps">
        <div><p className="zcc-step-title">01 · Authorize</p><p className="zcc-step-text">Sign in to Zoom and review this development app’s permissions.</p></div>
        <div><p className="zcc-step-title">02 · Open Zoom</p><p className="zcc-step-text">Launch Zoom Workplace from your browser and allow the open-app prompt.</p></div>
        <div><p className="zcc-step-title">03 · Test an engagement</p><p className="zcc-step-text">Open the sample during an engagement from a queue assigned to the app.</p></div>
      </section>
      <details className="zcc-details">
        <summary>Before your first engagement</summary>
        <ul>
          <li>Use a Zoom account with Contact Center access.</li>
          <li>Ask a Contact Center admin to assign the app to your test queue.</li>
          <li>Account approval and development app eligibility still apply. Use Development → Local Test in Marketplace if authorization is unavailable.</li>
        </ul>
        <a className="zcc-link" href="https://developers.zoom.us/docs/contact-center/apps/" target="_blank" rel="noreferrer">Explore the Contact Center developer guide ↗</a>
      </details>
    </div>
  );
}
