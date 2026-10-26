import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const montserrat = Montserrat({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-montserrat',
});

export const metadata: Metadata = {
  title: 'Forest Admin',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz" className={montserrat.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
