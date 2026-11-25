"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, clearToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import NotificationsBell from "@/components/NotificationsBell";
import ShellNav, { type ShellNavItem } from "@/components/ShellNav";
import DevRoleSwitcher from "@/components/DevRoleSwitcher";
import PageTransition from "@/components/PageTransition";

interface Me {
  id: string;
  email: string;
  full_name: string | null;
  specialty: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

const navItems: ShellNavItem[] = [
  { numeral: "I", href: "/admin", label: "Dashboard" },
  { numeral: "II", href: "/admin/leads", label: "Leads" },
  { numeral: "III", href: "/admin/projects", label: "Proyectos" },
  { numeral: "IV", href: "/admin/users", label: "Usuarios" },
  { numeral: "V", href: "/admin/pricing", label: "Pricing" },
  { numeral: "VI", href: "/admin/audit", label: "Auditoría" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);

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
          // A temporary password must be replaced before any guarded page:
          // the backend answers 403 on everything except the auth endpoints.
          if (me.must_change_password) {
            router.replace("/change-password");
            return;
          }
          if (me.role === "CLIENT") {
            router.replace("/portal");
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
    <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-4 pb-10 pt-20 sm:px-6 md:mx-0 md:ml-[15rem] md:pt-2">
      <ShellNav
        contextLabel="ADMIN"
        items={navItems}
        footer={
          <>
            <NotificationsBell role={role} />
            <button
              onClick={() => {
                clearToken();
                router.push("/login");
              }}
              className="type-ui min-h-[44px] text-sm underline underline-offset-4 transition-[opacity,transform] duration-[250ms] hover:translate-x-1"
            >
              Salir
            </button>
          </>
        }
      />

      <div key={`${role ?? "anon"}-${sessionVersion}`} className="mt-6 flex-1">
        <PageTransition preserveProjectShell>{children}</PageTransition>
      </div>

      <DevRoleSwitcher
        currentRole={role}
        onRoleSwitched={(nextRole) => {
          setRole(nextRole);
          setSessionVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
