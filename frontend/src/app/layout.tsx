import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { connection } from 'next/server';
import './globals.css';
import { Providers } from './providers';

const sans = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'InventoryMGR', template: '%s | InventoryMGR' },
  description: 'Auditable inventory for virtual machines, storage arrays, and physical infrastructure.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const csrfCookieName = process.env.CSRF_COOKIE_NAME ?? 'inventorymgr_csrf';
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <meta name="inventorymgr-csrf-cookie" content={csrfCookieName} />
      </head>
      <body>
        <script id="theme-init" src="/theme-init.js" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
