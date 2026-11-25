"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

export default function AdminDashboard() {
  const [userCount, setUserCount] = useState<number | null>(null);
  const [auditCount, setAuditCount] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const [usersRes, auditRes] = await Promise.all([
        apiFetch("/api/v1/admin/users").catch(() => null),
        apiFetch("/api/v1/admin/audit-logs?limit=200").catch(() => null),
      ]);
      if (usersRes && usersRes.ok) {
        const users = await usersRes.json();
        setUserCount(Array.isArray(users) ? users.length : null);
      }
      if (auditRes && auditRes.ok) {
        const logs = await auditRes.json();
        setAuditCount(Array.isArray(logs) ? logs.length : null);
      }
    }
    load();
  }, []);

  const shortcuts = [
    {
      num: "01",
      title: "Proyectos",
      desc: "Gestiona portafolio activo, briefs, fases, entregas y librería de assets.",
      href: "/admin/projects",
    },
    {
      num: "02",
      title: "Leads y cotizaciones",
      desc: "Calcula presupuestos, genera propuestas y convierte prospectos en proyectos.",
      href: "/admin/leads",
    },
    {
      num: "03",
      title: "Usuarios y accesos",
      desc: "Administra cuentas del equipo, clientes, roles y restablecimientos de contraseña.",
      href: "/admin/users",
    },
    {
      num: "04",
      title: "Configuración de precios",
      desc: "Define tarifas base por m², branding, multiplicador integral y rondas incluidas.",
      href: "/admin/pricing",
    },
    {
      num: "05",
      title: "Registro de auditoría",
      desc: "Consulta el historial de acciones administrativas y cambios críticos.",
      href: "/admin/audit",
    },
  ];

  return (
    <section className="brief-editorial space-y-8">
      <div className="border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-500">Estudio · Back-office</p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          Panel de administración
        </h1>
      </div>

      {/* Horizontal KPI Strip */}
      <div className="grid grid-cols-1 divide-y divide-stone-900/10 rounded-2xl border border-stone-900/15 bg-background shadow-editorial sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="p-6 md:p-7">
          <p className="type-tech text-stone-500">Usuarios registrados</p>
          <p className="type-title mt-2 text-4xl tabular-nums text-stone-900">
            {userCount ?? "—"}
          </p>
        </div>
        <div className="p-6 md:p-7">
          <p className="type-tech text-stone-500">Eventos de auditoría</p>
          <p className="type-title mt-2 text-4xl tabular-nums text-stone-900">
            {auditCount ?? "—"}
          </p>
        </div>
      </div>

      {/* Studio Index */}
      <div className="rounded-2xl border border-stone-900/15 bg-background shadow-editorial">
        <div className="border-b border-stone-900/10 px-6 py-4 md:px-7">
          <p className="type-tech text-stone-500">Módulos de gestión</p>
        </div>
        <div className="divide-y divide-stone-900/10">
          {shortcuts.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-surface/45 md:px-7"
            >
              <div className="flex min-w-0 items-baseline gap-4">
                <span className="type-tech w-6 shrink-0 text-stone-400">
                  {item.num}
                </span>
                <div className="min-w-0">
                  <p className="type-editorial text-lg text-stone-900">
                    {item.title}
                  </p>
                  <p className="type-ui mt-0.5 text-xs text-stone-500">
                    {item.desc}
                  </p>
                </div>
              </div>
              <span
                aria-hidden="true"
                className="type-ui shrink-0 text-sm text-stone-400 transition-colors group-hover:text-stone-900"
              >
                ↗
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
