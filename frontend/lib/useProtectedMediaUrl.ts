"use client";

import { useEffect, useState } from "react";
import { apiFetchBlobUrl } from "./api";

/**
 * Protected media needs the Bearer token, so plain <img>/<audio> URLs cannot
 * be used: fetch a blob URL through apiFetch and revoke it on unmount.
 *
 * Shared by the client portal and the admin brief view.
 */
export function useProtectedMediaUrl(
  url: string | null | undefined
): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setSrc(null);
    apiFetchBlobUrl(url)
      .then((loaded) => {
        if (!active) {
          URL.revokeObjectURL(loaded);
          return;
        }
        objectUrl = loaded;
        setSrc(loaded);
      })
      .catch(() => {
        if (active) setSrc(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return src;
}
