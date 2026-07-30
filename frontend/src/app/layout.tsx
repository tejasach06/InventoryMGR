import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
import { Geist } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const sans = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const display = Geist({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: 'InventoryMGR',
  description: 'Virtual machine inventory management',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <body>
        <script id="theme-init" src="/theme-init.js" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
