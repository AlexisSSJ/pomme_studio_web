"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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

const ENTITY_FILTERS = [
  { value: "", label: "Todas" },
  { value: "user", label: "Usuarios" },
  { value: "pricing_config", label: "Precios" },
];

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filter, setFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    const params = filter ? `?entity_type=${filter}` : "";
    const res = await apiFetch(`/api/v1/admin/audit-logs${params}`);
    if (res.ok) setLogs(await res.json());
  }, [filter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (log) =>
        log.action.toLowerCase().includes(q) ||
        log.entity_type.toLowerCase().includes(q) ||
        (log.entity_id?.toLowerCase().includes(q) ?? false)
    );
  }, [logs, searchQuery]);

  return (
    <section className="brief-editorial space-y-8">
      <div className="border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-500">Trazabilidad y seguridad</p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          Registro de auditoría
        </h1>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-surface/80 p-1">
          {ENTITY_FILTERS.map((opt) => (
            <button
              key={opt.value || "all"}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={`type-ui min-h-[38px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-xs transition-colors ${
                filter === opt.value
                  ? "bg-background font-medium text-stone-900 shadow-editorial"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por acción o entidad…"
          aria-label="Buscar eventos de auditoría"
          className="type-ui min-h-[42px] w-full rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45 sm:w-64"
        />
      </div>

      {/* Hairline Chronological Log */}
      <div className="rounded-2xl border border-stone-900/15 bg-background shadow-editorial">
        {filteredLogs.length === 0 ? (
          <p className="type-editorial p-7 text-base italic text-stone-500">
            Sin registros de auditoría para este filtro.
          </p>
        ) : (
          <div className="divide-y divide-stone-900/10">
            {filteredLogs.map((log) => {
              const hasMeta =
                log.metadata_json && Object.keys(log.metadata_json).length > 0;
              const isExpanded = expandedId === log.id;

              return (
                <div
                  key={log.id}
                  className="px-6 py-4 transition-colors hover:bg-surface/35 md:px-7"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="type-ui text-sm font-medium text-stone-900">
                        {log.action}
                      </p>
                      <p className="type-tech mt-0.5 text-stone-500">
                        {log.entity_type}
                        {log.entity_id
                          ? ` · ${log.entity_id.slice(0, 8)}…`
                          : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="type-tech tabular-nums text-stone-400">
                        {new Date(log.created_at).toLocaleString("es-MX", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {hasMeta && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId((prev) =>
                              prev === log.id ? null : log.id
                            )
                          }
                          aria-expanded={isExpanded}
                          className="type-tech shrink-0 whitespace-nowrap text-stone-600 underline decoration-stone-900/25 underline-offset-4 transition-colors hover:text-stone-900"
                        >
                          {isExpanded ? "Ocultar" : "Detalle"}
                        </button>
                      )}
                    </div>
                  </div>

                  {hasMeta && isExpanded && (
                    <pre className="animate-panel-enter mt-3 overflow-x-auto rounded-xl border border-stone-900/10 bg-surface/65 p-3.5 font-mono text-xs text-stone-700">
                      {JSON.stringify(log.metadata_json, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
