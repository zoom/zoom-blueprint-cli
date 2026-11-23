import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ThemeProvider } from 'next-themes';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zoom Contact Center Engagement Explorer',
  description: 'Authorize in your browser, open Zoom, and explore Contact Center engagement context.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const embedded = (await headers()).has('x-zoom-app-device-type');
  return (
    <html lang="en" suppressHydrationWarning>
      <head><link rel="stylesheet" href="/onboarding.css" /></head>
      <body className={embedded ? 'bg-background text-foreground' : 'zcc-browser'} suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={embedded}>
          {embedded ? children : (
            <div className="zcc-shell">
              <header className="zcc-header">
                <a className="zcc-brand" href="/" aria-label="Engagement Explorer setup">
                  <span className="zcc-wordmark">zoom</span><span className="zcc-product">Contact Center</span>
                </a>
                <span className="zcc-sample">Developer sample</span>
              </header>
              <main className="zcc-content">{children}</main>
              <footer className="zcc-footer">Engagement Explorer · Built with the Zoom Apps SDK</footer>
            </div>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
