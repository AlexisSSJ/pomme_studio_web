"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { isAuthenticated, clearToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import NotificationsBell from "@/components/NotificationsBell";

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

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [role, setRole] = useState<string | null>(null);

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
          if (me.role !== "CLIENT") {
            router.replace("/admin");
            return;
          }
          setRole(me.role);
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
        <p className="type-ui text-sm text-stone-600">Cargando…</p>
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-4 pb-10 pt-2 sm:px-6">
      <header className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 border-b border-border py-3">
        <span className="label-mono">PORTAL / CLIENTE</span>
        <div className="flex items-center gap-3">
          <NotificationsBell role={role} />
          <button
            onClick={() => {
              clearToken();
              router.push("/login");
            }}
            className="type-ui min-h-[44px] px-2 text-sm underline"
          >
            Salir
          </button>
        </div>
      </header>

      <nav className="grid-brutal mt-4">
        <Link
          href="/portal"
          className={`type-ui flex min-h-[44px] items-center justify-center p-3 text-sm ${
            pathname === "/portal" ? "bg-surface font-semibold" : ""
          }`}
        >
          Mis proyectos
        </Link>
      </nav>

      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}
