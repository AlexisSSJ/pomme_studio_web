"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface ShellNavItem {
  numeral: string;
  label: string;
  href: string;
}

interface ShellNavProps {
  /** Etiqueta de contexto bajo la marca: ADMIN / PORTAL. */
  contextLabel: string;
  /** Índice numeral del shell; el primer elemento es la raíz del shell. */
  items: ShellNavItem[];
  /** Utilidades al pie de la columna (notificaciones, salir). */
  footer?: React.ReactNode;
}

const BASE_LINK =
  "flex w-fit items-baseline gap-2 transition-[opacity,transform] duration-[250ms] ease hover:translate-x-1 focus-visible:!opacity-100";

/* Reposo atenuado; el grupo sube a 0.75; el enlace apuntado usa !important
 * para vencer de forma determinista al group-hover. */
const IDLE_LINK = `${BASE_LINK} opacity-40 group-hover:opacity-75 hover:!opacity-100`;

/* Ruta activa: legible siempre, con subrayado fino persistente. */
const ACTIVE_LINK = `${BASE_LINK} !opacity-90 underline underline-offset-4 decoration-[1px]`;

function linkClass(active: boolean): string {
  return active ? ACTIVE_LINK : IDLE_LINK;
}

/* El panel de notificaciones se ancla a la derecha de su contenedor; dentro
 * de una columna de 220px se saldría del lienzo. Lo reanclamos a la izquierda
 * sin tocar el interior del componente. */
const FOOTER_BASE =
  "group flex flex-col items-start gap-2 [&_#notifications-panel]:left-0 [&_#notifications-panel]:right-auto";

const FOOTER_DESKTOP = `${FOOTER_BASE} mt-8 opacity-40 transition-[opacity,transform] duration-[250ms] hover:opacity-75 focus-within:!opacity-100`;

const FOOTER_MOBILE = `${FOOTER_BASE} mt-8`;

export default function ShellNav({
  contextLabel,
  items,
  footer,
}: ShellNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // La raíz del shell ("/admin", "/portal") solo se activa por coincidencia
  // exacta; el resto de rutas también se activan en sus subrutas.
  const rootHref = items[0]?.href ?? "";

  function isActive(href: string): boolean {
    if (pathname === href) return true;
    if (href === rootHref) return false;
    return pathname.startsWith(href);
  }

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      {/* Columna editorial fija (desktop). Sin fondo, sin bordes. */}
      <div className="group fixed left-8 top-8 z-50 hidden max-w-[220px] text-left md:block">
        <Link
          href={rootHref}
          className="block w-fit text-[15px] font-semibold tracking-tightest opacity-40 transition-[opacity] duration-[250ms] group-hover:opacity-75"
        >
          POMME STUDIO
        </Link>
        <p className="label-mono mt-2 opacity-40 transition-[opacity] duration-[250ms] group-hover:opacity-75">
          {contextLabel}
        </p>

        <nav aria-label="Principal" className="mt-8 flex flex-col gap-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={linkClass(isActive(item.href))}
            >
              <span className="label-mono">{item.numeral}.</span>
              <span className="type-editorial text-sm">{item.label}</span>
            </Link>
          ))}
        </nav>

        {footer && <div className={FOOTER_DESKTOP}>{footer}</div>}
      </div>

      {/* Disparador mínimo (móvil): marca translúcida + MENÚ. */}
      <div className="group fixed left-4 top-4 z-50 flex items-center gap-4 md:hidden">
        <Link
          href={rootHref}
          className="text-[15px] font-semibold tracking-tightest opacity-40 transition-[opacity] duration-[250ms] group-hover:opacity-75"
        >
          POMME STUDIO
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="shell-nav-mobile"
          className="label-mono min-h-[44px] min-w-[44px] px-2 opacity-40 transition-[opacity] duration-[250ms] group-hover:opacity-75"
        >
          MENÚ
        </button>
      </div>

      {/* Overlay móvil sobre el fondo de página. */}
      {open && (
        <div
          id="shell-nav-mobile"
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background px-4 pb-10 pt-4 md:hidden"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[15px] font-semibold tracking-tightest">
                POMME STUDIO
              </span>
              <p className="label-mono mt-1">{contextLabel}</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setOpen(false)}
              className="label-mono min-h-[44px] min-w-[44px] px-2 text-right"
            >
              CERRAR
            </button>
          </div>

          <nav aria-label="Principal" className="mt-8 flex flex-col">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`flex min-h-[44px] items-baseline gap-3 py-3 ${
                  isActive(item.href)
                    ? "underline underline-offset-4 decoration-[1px]"
                    : ""
                }`}
              >
                <span className="label-mono">{item.numeral}.</span>
                <span className="type-editorial text-sm">{item.label}</span>
              </Link>
            ))}
          </nav>

          {footer && <div className={FOOTER_MOBILE}>{footer}</div>}
        </div>
      )}
    </>
  );
}
