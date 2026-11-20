"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export default function AdminDashboard() {
  const [userCount, setUserCount] = useState<number | null>(null);
  const [auditCount, setAuditCount] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const usersRes = await apiFetch("/api/v1/admin/users");
      if (usersRes.ok) {
        const users = await usersRes.json();
        setUserCount(users.length);
      }
      const auditRes = await apiFetch("/api/v1/admin/audit-logs?limit=200");
      if (auditRes.ok) {
        const logs = await auditRes.json();
        setAuditCount(logs.length);
      }
    }
    load();
  }, []);

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Panel de administración</h1>
      <div className="grid-brutal grid-brutal--2 mt-6">
        <div className="p-5">
          <p className="label-mono">Usuarios registrados</p>
          <p className="mt-2 text-3xl tracking-tightest">
            {userCount ?? "—"}
          </p>
        </div>
        <div className="p-5">
          <p className="label-mono">Eventos de auditoría</p>
          <p className="mt-2 text-3xl tracking-tightest">
            {auditCount ?? "—"}
          </p>
        </div>
      </div>
    </section>
  );
}
