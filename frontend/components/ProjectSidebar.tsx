"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface ProjectNavItem {
  href: string;
  label: string;
}

interface ProjectSidebarProps {
  basePath: string;
  title: string;
  status?: string | null;
  items: ProjectNavItem[];
}

export default function ProjectSidebar({
  basePath,
  title,
  status,
  items,
}: ProjectSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="md:w-64 md:shrink-0 md:pr-8">
      {/* Ficha de estudio: micro-tipografía a los extremos + título serif. */}
      <div className="mb-6 border-b border-stone-900/15 pb-6">
        <div className="flex items-center justify-between gap-4 text-[11px] uppercase tracking-[0.18em] text-stone-500">
          <span>Proyecto</span>
          {status && (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="dot-organic h-1.5 w-1.5 shrink-0 bg-stone-800/70"
              />
              {status}
            </span>
          )}
        </div>
        <h2 className="mt-3 font-serif text-2xl font-normal leading-snug tracking-tight text-stone-900">
          {title}
        </h2>
      </div>

      {/* Índice de catálogo: abierto, sin cajas ni divisores entre ítems. */}
      <nav
        aria-label="Secciones del proyecto"
        className="flex gap-6 overflow-x-auto md:flex-col md:gap-1 md:overflow-visible"
      >
        {items.map((item, index) => {
          const active =
            item.href === basePath
              ? pathname === basePath
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[44px] shrink-0 items-center gap-3 whitespace-nowrap transition-all duration-300 md:shrink ${
                active
                  ? "translate-x-1.5"
                  : "text-[15px] text-stone-500 hover:translate-x-1 hover:text-stone-900"
              }`}
            >
              <span className="font-mono text-[11px] tabular-nums text-stone-400">
                1.{index + 1}
              </span>
              <span
                className={
                  active
                    ? "font-serif text-[16px] italic text-stone-950 underline decoration-stone-900/40 underline-offset-[6px]"
                    : undefined
                }
              >
                {item.label}
              </span>
              {active && (
                <span
                  aria-hidden="true"
                  className="ml-auto hidden text-stone-950 md:inline"
                >
                  —
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
