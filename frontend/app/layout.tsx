import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="es">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
