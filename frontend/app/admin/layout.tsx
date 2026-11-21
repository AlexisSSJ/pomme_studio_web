"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { isAuthenticated, clearToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface Me {
  id: string;
  email: string;
  full_name: string | null;
  specialty: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const navItems = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/projects", label: "Proyectos" },
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/pricing", label: "Pricing" },
  { href: "/admin/audit", label: "Auditoría" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    async function loadMe() {
      try {
        const res = await apiFetch("/api/v1/auth/me");
        if (cancelled) return;
        if (res.ok) {
          const me: Me = await res.json();
          if (me.role === "CLIENT") {
            router.replace("/portal");
            return;
          }
          setChecked(true);
        } else {
          // The role could not be confirmed (e.g. deactivated account);
          // fail closed and send the visitor back to login.
          router.replace("/login");
        }
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      }
    }

    loadMe();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="label-mono">Cargando…</p>
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-4 pb-10 pt-2 sm:px-6">
      <header className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 border-b border-border py-3">
        <span className="text-[15px] font-semibold tracking-tightest">
          Pomme Studio / Admin
        </span>
        <button
          onClick={() => {
            clearToken();
            router.push("/login");
          }}
          className="label-mono min-h-[44px] px-2 underline"
        >
          Salir
        </button>
      </header>

      <nav className="grid-brutal mt-4 grid-cols-2 sm:grid-cols-3">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex min-h-[44px] items-center justify-center p-3 text-sm ${
              pathname === item.href ? "bg-surface font-semibold" : ""
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}
