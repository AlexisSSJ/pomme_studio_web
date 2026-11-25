"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { apiFetch, extractDetail } from "@/lib/api";

interface Lead {
  id: string;
  contact_name: string;
  email: string;
  service_type: string;
  space_type: string | null;
  area_m2: string | null;
  budget_range: string | null;
  status: string;
  created_at: string;
}

interface QuoteLine {
  concept: string;
  amount: string;
}

interface Quote {
  service_type: string;
  area_m2: string | null;
  lines: QuoteLine[];
  multiplier: string;
  total: string;
  change_rounds: number;
}

interface Proposal extends Quote {
  lead_id: string;
  generated_at: string;
}

function formatMoney(value: string) {
  return Number(value).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [convertLoading, setConvertLoading] = useState(false);
  const quoteRequestSeq = useRef(0);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/leads");
      if (res.ok) {
        setLeads(await res.json());
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar leads"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  async function selectLead(lead: Lead) {
    const requestSeq = ++quoteRequestSeq.current;
    setSelectedLead(lead);
    setQuote(null);
    setQuoteError(null);
    setQuoteLoading(true);
    setShowConvertForm(false);
    setMessage("");
    try {
      const res = await apiFetch(`/api/v1/admin/leads/${lead.id}/quote`);
      if (res.ok) {
        const data = (await res.json()) as Quote;
        if (requestSeq === quoteRequestSeq.current) setQuote(data);
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        if (requestSeq !== quoteRequestSeq.current) return;
        const detail = extractDetail(data, "Error al cargar cotización");
        setQuoteError(detail);
        setMessage(detail);
      }
    } catch {
      if (requestSeq !== quoteRequestSeq.current) return;
      const detail = "Error de conexión con el servidor";
      setQuoteError(detail);
      setMessage(detail);
    } finally {
      if (requestSeq === quoteRequestSeq.current) setQuoteLoading(false);
    }
  }

  async function generateProposal() {
    if (!selectedLead) return;
    setProposalLoading(true);
    setMessage("");
    try {
      const res = await apiFetch(
        `/api/v1/admin/leads/${selectedLead.id}/proposal`,
        { method: "POST" }
      );
      if (res.ok) {
        const proposal: Proposal = await res.json();
        setQuote(proposal);
        setMessage("Propuesta generada correctamente.");
        loadLeads();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al generar propuesta"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setProposalLoading(false);
    }
  }

  async function convertLead(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) return;
    setConvertLoading(true);
    setMessage("");
    const body: { title: string; client_id?: string } = { title };
    const trimmedClientId = clientId.trim();
    if (trimmedClientId) {
      body.client_id = trimmedClientId;
    }
    try {
      const res = await apiFetch(
        `/api/v1/admin/leads/${selectedLead.id}/convert`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      if (res.ok) {
        quoteRequestSeq.current += 1;
        setMessage("Lead convertido en proyecto.");
        setTitle("");
        setClientId("");
        setShowConvertForm(false);
        setSelectedLead(null);
        setQuote(null);
        setQuoteLoading(false);
        loadLeads();
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al convertir lead"));
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setConvertLoading(false);
    }
  }

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (lead) =>
        lead.contact_name.toLowerCase().includes(q) ||
        lead.email.toLowerCase().includes(q) ||
        lead.service_type.toLowerCase().includes(q) ||
        lead.status.toLowerCase().includes(q)
    );
  }, [leads, searchQuery]);

  return (
    <section className="brief-editorial space-y-8">
      <div className="border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-500">Prospección y presupuestos</p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          Leads
        </h1>
      </div>

      {message && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3">
          <p className="type-ui text-sm text-stone-800">{message}</p>
          <button
            type="button"
            onClick={() => setMessage("")}
            aria-label="Cerrar mensaje"
            className="type-tech text-stone-500 hover:text-stone-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* Editorial Split Workspace */}
      <div className="grid grid-cols-1 divide-y divide-stone-900/10 overflow-hidden rounded-2xl border border-stone-900/15 bg-background shadow-editorial lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        {/* Left: Leads List */}
        <div className="flex flex-col lg:col-span-5">
          <div className="space-y-3 border-b border-stone-900/10 p-5">
            <div className="flex items-center justify-between">
              <p className="type-tech text-stone-500">Listado de prospectos</p>
              <span className="type-tech tabular-nums text-stone-400">
                {filteredLeads.length}
              </span>
            </div>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrar por nombre, correo o servicio…"
              aria-label="Buscar leads"
              className="type-ui min-h-[40px] w-full rounded-lg border border-stone-900/15 bg-surface/40 px-3 text-xs text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45 focus:bg-background"
            />
          </div>

          {loading && leads.length === 0 ? (
            <p className="type-ui p-5 text-sm text-stone-600">Cargando…</p>
          ) : filteredLeads.length === 0 ? (
            <p className="type-editorial p-5 text-sm italic text-stone-500">
              No hay leads registrados.
            </p>
          ) : (
            <div className="divide-y divide-stone-900/10">
              {filteredLeads.map((lead) => {
                const isSelected = selectedLead?.id === lead.id;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => selectLead(lead)}
                    disabled={loading}
                    className={`flex min-h-[76px] w-full flex-col items-start justify-center px-5 py-4 text-left transition-colors ${
                      isSelected
                        ? "bg-surface/80"
                        : "bg-background hover:bg-surface/40"
                    }`}
                  >
                    <div className="flex w-full items-baseline justify-between gap-2">
                      <span className="type-editorial truncate text-base font-medium text-stone-900">
                        {lead.contact_name}
                      </span>
                      <span className="type-tech shrink-0 text-[10px] text-stone-500">
                        {lead.status}
                      </span>
                    </div>
                    <span className="type-ui mt-0.5 truncate text-xs text-stone-500">
                      {lead.email}
                    </span>
                    <span className="type-tech mt-1.5 text-[10px] text-stone-400">
                      {lead.service_type}
                      {lead.area_m2 ? ` · ${lead.area_m2} m²` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Detail & Quote Canvas */}
        <div className="p-6 md:p-7 lg:col-span-7">
          {!selectedLead ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
              <p className="type-editorial text-lg text-stone-700">
                Selecciona un lead del listado
              </p>
              <p className="type-ui mt-1 max-w-xs text-xs text-stone-500">
                Aquí podrás revisar la cotización estimada, generar la propuesta
                y convertir el prospecto en proyecto.
              </p>
            </div>
          ) : (
            <div key={selectedLead.id} className="animate-panel-enter space-y-6">
              {/* Lead Profile Header */}
              <div className="border-b border-stone-900/10 pb-5">
                <p className="type-tech text-stone-500">
                  {selectedLead.service_type} · {selectedLead.status}
                </p>
                <h2 className="type-title mt-1.5 text-2xl text-stone-900">
                  {selectedLead.contact_name}
                </h2>
                <p className="type-ui mt-1 text-sm text-stone-600">
                  {selectedLead.email}
                  {selectedLead.space_type ? ` · ${selectedLead.space_type}` : ""}
                  {selectedLead.area_m2 ? ` · ${selectedLead.area_m2} m²` : ""}
                  {selectedLead.budget_range
                    ? ` · Presupuesto: ${selectedLead.budget_range}`
                    : ""}
                </p>
              </div>

              {quoteLoading ? (
                <p className="type-ui text-sm text-stone-600">
                  Calculando cotización…
                </p>
              ) : quoteError ? (
                <p className="type-ui text-sm text-stone-600">
                  No se pudo cargar la cotización. {quoteError}
                </p>
              ) : quote ? (
                <div className="space-y-6">
                  {/* Tabular Quote Breakdown */}
                  <div>
                    <p className="type-tech text-stone-500">
                      Desglose de cotización
                    </p>
                    <div className="mt-3 divide-y divide-stone-900/10 border-y border-stone-900/10">
                      {quote.lines.map((line, index) => (
                        <div
                          key={index}
                          className="flex min-h-[44px] items-center justify-between gap-4 py-2.5"
                        >
                          <span className="type-ui text-sm text-stone-700">
                            {line.concept}
                          </span>
                          <span className="font-mono text-sm tabular-nums text-stone-900">
                            ${formatMoney(line.amount)}
                          </span>
                        </div>
                      ))}
                      <div className="flex min-h-[52px] items-center justify-between gap-4 pt-3">
                        <span className="type-tech text-stone-900">
                          Total estimado · {quote.change_rounds} rondas
                        </span>
                        <span className="type-title text-2xl tabular-nums text-stone-900">
                          ${formatMoney(quote.total)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={generateProposal}
                      disabled={proposalLoading}
                      className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                    >
                      {proposalLoading
                        ? "Generando…"
                        : "Generar propuesta ↗"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowConvertForm((prev) => !prev)}
                      className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-5 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background"
                    >
                      {showConvertForm
                        ? "Cerrar conversión"
                        : "Convertir en proyecto"}
                    </button>
                  </div>

                  {/* Collapsible Convert Form */}
                  {showConvertForm && (
                    <form
                      onSubmit={convertLead}
                      className="animate-panel-enter space-y-4 rounded-xl border border-stone-900/15 bg-surface/65 p-5"
                    >
                      <p className="type-tech text-stone-700">
                        Convertir prospecto en proyecto activo
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1.5">
                          <span className="type-ui text-xs text-stone-600">
                            Título del proyecto *
                          </span>
                          <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                            minLength={3}
                            placeholder="Ej. Casa Lomas"
                            className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="type-ui text-xs text-stone-600">
                            Client ID (opcional)
                          </span>
                          <input
                            type="text"
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            placeholder="UUID de usuario cliente"
                            className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900/45"
                          />
                        </label>
                      </div>
                      <button
                        type="submit"
                        disabled={convertLoading}
                        className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
                      >
                        {convertLoading
                          ? "Convirtiendo…"
                          : "Confirmar y crear proyecto ↗"}
                      </button>
                    </form>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
