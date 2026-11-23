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
    <aside className="sm:w-[220px] sm:shrink-0">
      <div className="flex flex-col gap-px border border-border bg-border">
        <div className="bg-surface p-3">
          <p className="label-mono">Proyecto</p>
          <p className="mt-1 text-sm font-semibold leading-snug">{title}</p>
          {status && <p className="label-mono mt-1">{status}</p>}
        </div>

        <nav
          aria-label="Secciones del proyecto"
          className="flex gap-px overflow-x-auto bg-border sm:flex-col sm:overflow-visible"
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
                className={`flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm sm:shrink ${
                  active
                    ? "bg-foreground text-background"
                    : "bg-background hover:bg-surface"
                }`}
              >
                <span className="label-mono">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item.label}</span>
                {active && !item.label.includes("↗") && (
                  <span aria-hidden="true" className="ml-auto hidden sm:inline">
                    ↗
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
