function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function renderOnboardingPage(options: { launchUrl?: string; error?: string }) {
  const success = Boolean(options.launchUrl);
  const title = success ? 'Continue in Zoom Contact Center' : 'Let’s get you connected';
  const content = success
    ? '<p class="zcc-lead">Your Zoom account is connected. Launch Zoom Workplace to continue exploring this Contact Center sample.</p>' +
      '<a class="zcc-button" href="' + escapeHtml(options.launchUrl!) + '">Launch Zoom Workplace <span aria-hidden="true">↗</span></a>' +
      '<p class="zcc-small zcc-action-note">When your browser asks, choose <strong>Open zoom.us</strong> or <strong>Open Zoom Workplace</strong>.<br>If no prompt appears, click the launch button again.</p>' +
      '<aside class="zcc-notice"><h2>Next, explore a live engagement</h2><p>Have your Contact Center admin assign this app to a test queue. Open the app during an engagement from that queue to see its context and status update.</p></aside>' +
      '<p class="zcc-small zcc-secondary">You can close this tab after Zoom opens.</p>'
    : '<p class="zcc-lead">' + escapeHtml(options.error || 'We couldn’t finish connecting to Zoom. Return to setup and try again.') + '</p>' +
      '<a class="zcc-button" href="/">Back to setup <span aria-hidden="true">→</span></a>' +
      '<aside class="zcc-notice"><h2>Check your development setup</h2><p>Keep zoom dev running. Confirm that the app credentials are configured and the current public URL is synced to Marketplace. Your account may require admin approval.</p></aside>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + ' · Engagement Explorer</title><link rel="stylesheet" href="/onboarding.css"></head>' +
    '<body class="zcc-browser"><div class="zcc-shell"><header class="zcc-header"><a class="zcc-brand" href="/" aria-label="Engagement Explorer setup">' +
    '<span class="zcc-wordmark">zoom</span><span class="zcc-product">Contact Center</span></a><span class="zcc-sample">Developer sample</span></header>' +
    '<main class="zcc-content"><section class="zcc-result"><div class="zcc-status' + (success ? '' : ' zcc-status-error') + '" aria-hidden="true">' +
    (success ? '✓' : '!') + '</div><p class="zcc-eyebrow">' + (success ? 'Authorization complete' : 'Setup needs attention') +
    '</p><h1>' + title + '</h1>' + content + '</section></main>' +
    '<footer class="zcc-footer">Engagement Explorer · Built with the Zoom Apps SDK</footer></div></body></html>';
}
