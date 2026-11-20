import type { MetadataRoute } from 'next';

/**
 * Manifiesto PWA mínimo. Task 6 amplía este archivo (iconos definitivos,
 * propósito maskable y metadatos de instalación).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pomme Studio',
    short_name: 'Pomme',
    description: 'Branding y diseño de interiores',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F7F5',
    theme_color: '#111111',
    orientation: 'portrait',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
