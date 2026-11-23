"use client";

import { useEffect, useState } from "react";
import { apiFetchBlobUrl } from "./api";

export interface ProtectedMediaState {
  /** Blob URL listo para usar en <img>/<audio>, o `null` mientras carga o si falló. */
  url: string | null;
  /** `true` solo cuando la petición terminó en error (≠ cargando). */
  error: boolean;
}

/**
 * Protected media needs the Bearer token, so plain <img>/<audio> URLs cannot
 * be used: fetch a blob URL through apiFetch and revoke it on unmount.
 *
 * Shared by the client portal and the admin brief view.
 *
 * Devuelve también el estado de error para distinguir "cargando" de
 * "no se pudo cargar".
 */
export function useProtectedMedia(
  url: string | null | undefined
): ProtectedMediaState {
  const [state, setState] = useState<ProtectedMediaState>({
    url: null,
    error: false,
  });

  useEffect(() => {
    if (!url) {
      setState({ url: null, error: false });
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setState({ url: null, error: false });
    apiFetchBlobUrl(url)
      .then((loaded) => {
        if (!active) {
          URL.revokeObjectURL(loaded);
          return;
        }
        objectUrl = loaded;
        setState({ url: loaded, error: false });
      })
      .catch(() => {
        if (active) setState({ url: null, error: true });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return state;
}

/**
 * Compatibilidad: consumidores previos solo necesitan la URL.
 */
export function useProtectedMediaUrl(
  url: string | null | undefined
): string | null {
  return useProtectedMedia(url).url;
}
