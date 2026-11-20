#!/usr/bin/env node
/**
 * Genera los iconos PWA de Pomme Studio (Tactile Brutalism).
 *
 * Sin dependencias: dibuja la geometría en un buffer RGBA supersampleado,
 * lo reduce con box-filter (bordes limpios, sin antialiasing de librería)
 * y escribe PNG con zlib de Node.
 *
 * Uso: node scripts/generate-icons.mjs
 *
 * Estética: retícula ortogonal, monocromo #111111 sobre #F7F7F5,
 * sin degradados, sin sombras, sin esquinas redondeadas.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../public/icons');

const INK = [0x11, 0x11, 0x11];
const PAPER = [0xf7, 0xf7, 0xf5];

/**
 * Geometría en un lienzo de referencia de 512x512 (se escala a cada tamaño).
 * Todo son rectángulos alineados a los ejes: nada de curvas ni diagonales.
 */
const INK_BLOCK = { x0: 112, y0: 112, x1: 400, y1: 400 };

/** Monograma "P" recortado (knockout) dentro del bloque de tinta. */
const MONOGRAM = [
  // asta vertical
  { x0: 176, y0: 156, x1: 216, y1: 356 },
  // travesaño superior del ojo
  { x0: 216, y0: 156, x1: 336, y1: 196 },
  // asta derecha del ojo
  { x0: 296, y0: 156, x1: 336, y1: 276 },
  // travesaño inferior del ojo
  { x0: 216, y0: 236, x1: 336, y1: 276 },
];

const inside = (px, py, r) => px >= r.x0 && px < r.x1 && py >= r.y0 && py < r.y1;

function render(size, ss = 4) {
  const hi = size * ss;
  const buf = Buffer.alloc(hi * hi * 3, 0);
  const scale = 512 / hi;

  for (let y = 0; y < hi; y += 1) {
    const py = (y + 0.5) * scale;
    for (let x = 0; x < hi; x += 1) {
      const px = (x + 0.5) * scale;

      let color = PAPER;
      if (inside(px, py, INK_BLOCK)) color = INK;
      if (MONOGRAM.some((r) => inside(px, py, r))) color = PAPER;

      const i = (y * hi + x) * 3;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
    }
  }

  // Box-filter ss x ss -> size. Mantiene bordes rectos y definidos.
  const out = Buffer.alloc(size * size * 3);
  const n = ss * ss;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < ss; dy += 1) {
        for (let dx = 0; dx < ss; dx += 1) {
          const i = ((y * ss + dy) * hi + (x * ss + dx)) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

// --- Codificador PNG mínimo (RGB de 8 bits, sin dependencias) ---------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Scanlines con filtro 0 (None).
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const size of [192, 512]) {
  const png = encodePng(render(size), size);
  const file = resolve(OUT_DIR, `icon-${size}x${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`);
}
