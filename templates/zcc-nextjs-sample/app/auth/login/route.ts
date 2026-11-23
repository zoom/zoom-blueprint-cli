import { renderOnboardingPage } from '@/lib/onboarding-page';
import { NextResponse } from 'next/server';
import { beginAuthorization, STATE_COOKIE, STATE_COOKIE_PATH } from '@/lib/zoom-auth';

export const runtime = 'nodejs';
export function GET() {
  try {
    const { url, state, secure } = beginAuthorization();
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true, secure, sameSite: 'lax', path: STATE_COOKIE_PATH, maxAge: 600,
    });
    return response;
  } catch {
    return new Response(renderOnboardingPage({ error: 'Add this app’s Client ID and Client Secret to .env, then restart zoom dev. Make sure the callback URL matches the current public URL.' }), {
      status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
