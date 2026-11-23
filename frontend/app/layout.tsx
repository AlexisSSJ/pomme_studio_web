import type { Metadata, Viewport } from 'next';
import { Newsreader } from 'next/font/google';
import './globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
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
    <html lang="es" className={newsreader.variable}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
