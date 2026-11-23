"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface AuditLog {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filter, setFilter] = useState("");

  const loadLogs = useCallback(async () => {
    const params = filter ? `?entity_type=${filter}` : "";
    const res = await apiFetch(`/api/v1/admin/audit-logs${params}`);
    if (res.ok) setLogs(await res.json());
  }, [filter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <section>
      <h1 className="type-title text-xl">Registro de auditoría</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="type-ui text-sm">Filtrar por entidad:</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="type-ui min-h-[44px] border border-border bg-background px-3 text-sm"
        >
          <option value="">Todas</option>
          <option value="user">user</option>
          <option value="pricing_config">pricing_config</option>
        </select>
      </div>

      <div className="grid-brutal mt-6">
        {logs.map((log) => (
          <div key={log.id} className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{log.action}</p>
              <p className="label-mono">
                {new Date(log.created_at).toLocaleString("es")}
              </p>
            </div>
            <p className="label-mono mt-1">
              {log.entity_type}
              {log.entity_id ? ` · ${log.entity_id.slice(0, 8)}…` : ""}
            </p>
            {log.metadata_json && (
              <pre className="mt-2 overflow-x-auto border border-border bg-surface p-2 text-xs">
                {JSON.stringify(log.metadata_json, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="p-4">
            <p className="type-ui text-sm text-stone-600">Sin registros</p>
          </div>
        )}
      </div>
    </section>
  );
}
