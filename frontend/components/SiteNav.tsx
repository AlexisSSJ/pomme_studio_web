"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavChild {
  label: string;
  href: string;
}

interface NavItem {
  numeral: string;
  label: string;
  href: string;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { numeral: "I", label: "Estudio", href: "/#estudio" },
  {
    numeral: "II",
    label: "Servicios",
    href: "/#servicios",
    children: [
      { label: "Branding", href: "/#servicio-branding" },
      { label: "Dirección creativa", href: "/#servicio-direccion" },
      { label: "Doc. ejecutiva", href: "/#servicio-documentacion" },
      { label: "FF&E", href: "/#servicio-ffe" },
    ],
  },
  { numeral: "III", label: "Contacto", href: "/#contacto" },
  { numeral: "IV", label: "Diagnóstico", href: "/diagnostico" },
];

const BASE_LINK =
  "flex w-fit items-baseline gap-2 transition-[opacity,transform] duration-[250ms] hover:translate-x-1 focus-visible:!opacity-100";

/* Reposo atenuado; el grupo sube a 0.75; el enlace apuntado usa !important
 * para vencer de forma determinista al group-hover. */
const IDLE_LINK = `${BASE_LINK} opacity-40 group-hover:opacity-75 hover:!opacity-100`;

/* Ruta activa: legible siempre, con subrayado fino persistente. */
const ACTIVE_LINK = `${BASE_LINK} !opacity-90 underline underline-offset-4 decoration-[1px]`;

function linkClass(active: boolean): string {
  return active ? ACTIVE_LINK : IDLE_LINK;
}

export default function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  /* Cerrar siempre devuelve el foco al disparador MENÚ (CERRAR, Escape y
   * enlaces del overlay), que queda montado tanto en móvil como en desktop. */
  const closeMenu = useCallback(() => {
    setOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const activeHref =
    pathname === "/"
      ? "/#estudio"
      : pathname === "/diagnostico"
        ? "/diagnostico"
        : null;

  useEffect(() => {
    if (!open) return;

    // Bloqueo de scroll del fondo; guardamos el valor previo para no pisarlo.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    document.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, closeMenu]);

  return (
    <>
      {/* Columna editorial fija (desktop). Sin fondo, sin bordes. */}
      <div className="group fixed left-8 top-8 z-50 hidden max-w-[220px] text-left md:block">
        <Link
          href="/"
          className="block w-fit text-[15px] font-semibold tracking-tightest opacity-40 transition-[opacity] duration-[250ms] group-hover:opacity-75"
        >
          POMME STUDIO
        </Link>

        <nav aria-label="Principal" className="mt-8 flex flex-col gap-3">
          {NAV_ITEMS.map((item) => (
            <div key={item.href}>
              <Link
                href={item.href}
                aria-current={activeHref === item.href ? "page" : undefined}
                className={linkClass(activeHref === item.href)}
              >
                <span className="label-mono">{item.numeral}.</span>
                <span className="type-editorial text-sm">{item.label}</span>
              </Link>

              {item.children && (
                <div className="mt-2 flex flex-col gap-2 pl-4">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={linkClass(false)}
                    >
                      <span className="type-editorial text-sm">{child.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Disparador mínimo (móvil): marca translúcida + MENÚ. */}
      <div className="group fixed left-4 top-4 z-50 flex items-center gap-4 md:hidden">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-tightest opacity-40 transition-[opacity] duration-[250ms] group-hover:opacity-75 [@media(hover:none)]:opacity-70"
        >
          POMME STUDIO
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="site-nav-mobile"
          className="label-mono min-h-[44px] min-w-[44px] px-2 opacity-40 transition-[opacity] duration-[250ms] group-hover:opacity-75 [@media(hover:none)]:opacity-70"
        >
          MENÚ
        </button>
      </div>

      {/* Overlay móvil sobre el fondo de página. */}
      {open && (
        <div
          id="site-nav-mobile"
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background px-4 pb-10 pt-4 md:hidden"
        >
          <div className="flex items-center justify-between gap-4">
            <span className="text-[15px] font-semibold tracking-tightest">
              POMME STUDIO
            </span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeMenu}
              className="label-mono min-h-[44px] min-w-[44px] px-2 text-right"
            >
              CERRAR
            </button>
          </div>

          <nav aria-label="Principal" className="mt-8 flex flex-col">
            {NAV_ITEMS.map((item) => (
              <div key={item.href}>
                <Link
                  href={item.href}
                  onClick={closeMenu}
                  aria-current={activeHref === item.href ? "page" : undefined}
                  className={`flex min-h-[44px] items-baseline gap-3 py-3 ${
                    activeHref === item.href
                      ? "underline underline-offset-4 decoration-[1px]"
                      : ""
                  }`}
                >
                  <span className="label-mono">{item.numeral}.</span>
                  <span className="type-editorial text-sm">{item.label}</span>
                </Link>

                {item.children && (
                  <div className="flex flex-col">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={closeMenu}
                        className="type-editorial flex min-h-[44px] items-center py-2 pl-4 text-sm"
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
