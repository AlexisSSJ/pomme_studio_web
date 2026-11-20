import type { MetadataRoute } from 'next';

/**
 * Manifiesto PWA de Pomme Studio.
 *
 * Next.js App Router sirve este archivo en `/manifest.webmanifest` y
 * `app/layout.tsx` lo referencia con `metadata.manifest`.
 *
 * Nota: `MetadataRoute.Manifest` admite un único `purpose` por icono, por eso
 * cada tamaño declara dos entradas (any y maskable) sobre el mismo arte. Los
 * iconos se generan con `scripts/generate-icons.mjs` y respetan la zona segura
 * maskable (contenido dentro del 80% central).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pomme Studio',
    short_name: 'Pomme',
    description: 'Branding y diseño de interiores',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F7F7F5',
    theme_color: '#111111',
    lang: 'es',
    dir: 'ltr',
    categories: ['business', 'design', 'lifestyle'],
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
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
        purpose: 'any',
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
