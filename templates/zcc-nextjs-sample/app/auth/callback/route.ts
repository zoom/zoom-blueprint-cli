import { NextRequest, NextResponse } from 'next/server';
import { completeAuthorization, ZoomAuthError, STATE_COOKIE, STATE_COOKIE_PATH } from '@/lib/zoom-auth';

import { renderOnboardingPage } from '@/lib/onboarding-page';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  let launchUrl: string | undefined;
  let errorMessage: string | undefined;
  let status = 200;
  try {
    if (request.nextUrl.searchParams.has('error')) throw new ZoomAuthError('Authorization was declined. Return to the app to try again.');
    launchUrl = await completeAuthorization(
      request.nextUrl.searchParams.get('code') || '',
      request.nextUrl.searchParams.get('state') || '',
      request.cookies.get(STATE_COOKIE)?.value || '',
    );
  } catch (error) {
    status = 400;
    errorMessage = error instanceof ZoomAuthError
      ? error.message : 'We couldn’t reach Zoom. Check your connection and try again.';
  }
  const response = new NextResponse(renderOnboardingPage({ launchUrl, error: errorMessage }), {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
  response.cookies.set(STATE_COOKIE, '', { path: STATE_COOKIE_PATH, maxAge: 0 });
  return response;
}
