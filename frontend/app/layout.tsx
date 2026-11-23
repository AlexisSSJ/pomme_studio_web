import type { Metadata, Viewport } from 'next';
import { Amiri } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

const amiri = Amiri({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-amiri',
  display: 'swap',
});

const atkinsonMono = localFont({
  src: [
    {
      path: './fonts/atkinson-hyperlegible-mono.woff2',
      weight: '400 700',
      style: 'normal',
    },
  ],
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});

export const metadata: Metadata = {
  title: 'Pomme Studio — Branding y Diseño de Interiores',
  description:
    'Estudio de branding, dirección creativa, documentación ejecutiva y especificaciones FF&E.',
  applicationName: 'Pomme Studio',
  authors: [{ name: 'Pomme Studio' }],
  keywords: [
    'branding',
    'dirección creativa',
    'diseño de interiores',
    'FF&E',
    'documentación ejecutiva',
  ],
  formatDetection: {
    telephone: false,
  },
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111111',
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${amiri.variable} ${atkinsonMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
