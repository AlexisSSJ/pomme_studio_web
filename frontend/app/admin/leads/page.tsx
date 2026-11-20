"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  return Number(value).toFixed(2);
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
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
      const res = await apiFetch(`/api/v1/admin/leads/${selectedLead.id}/proposal`, {
        method: "POST",
      });
      if (res.ok) {
        const proposal: Proposal = await res.json();
        setQuote(proposal);
        setMessage("Propuesta generada");
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
      const res = await apiFetch(`/api/v1/admin/leads/${selectedLead.id}/convert`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        quoteRequestSeq.current += 1;
        setMessage("Lead convertido en proyecto");
        setTitle("");
        setClientId("");
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

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Leads</h1>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">{message}</p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-1 border border-border bg-foreground md:grid-cols-2">
        <div className="bg-background p-0">
          <p className="label-mono border-b border-border p-3">Listado</p>
          {loading && leads.length === 0 ? (
            <p className="p-3 text-sm">Cargando…</p>
          ) : (
            <div className="grid-brutal border-0">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => selectLead(lead)}
                  disabled={loading}
                  className={`flex min-h-[44px] w-full flex-col items-start justify-center p-3 text-left text-sm transition-colors hover:bg-surface focus-visible:bg-surface ${
                    selectedLead?.id === lead.id ? "bg-surface" : ""
                  }`}
                >
                  <span className="font-semibold">{lead.contact_name}</span>
                  <span className="text-xs">{lead.email}</span>
                  <span className="label-mono mt-1">
                    {lead.service_type} · {lead.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-background p-0">
          <p className="label-mono border-b border-border p-3">Detalle</p>
          <div className="p-3">
            {!selectedLead ? (
              <p className="text-sm text-foreground/70">Selecciona un lead para cotizar.</p>
            ) : quoteLoading ? (
              <p className="text-sm">Cargando cotización…</p>
            ) : quoteError ? (
              <p className="text-sm text-foreground/70">No se pudo cargar la cotización. {quoteError}</p>
            ) : quote ? (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="label-mono">Cotización</p>
                  <div className="mt-2 border border-border bg-surface p-3">
                    {quote.lines.map((line, index) => (
                      <div
                        key={index}
                        className="flex min-h-[44px] items-center justify-between border-b border-border py-2 last:border-0"
                      >
                        <span className="text-sm">{line.concept}</span>
                        <span className="text-sm font-semibold">
                          ${formatMoney(line.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="flex min-h-[44px] items-center justify-between border-t border-border pt-2">
                      <span className="label-mono">Total</span>
                      <span className="text-base font-semibold">
                        ${formatMoney(quote.total)}
                      </span>
                    </div>
                    <p className="label-mono mt-2">
                      Rondas de cambio: {quote.change_rounds}
                    </p>
                  </div>
                </div>

                <button
                  onClick={generateProposal}
                  disabled={proposalLoading}
                  className="btn-brutal w-full justify-center"
                >
                  {proposalLoading ? "Generando…" : "Generar propuesta"}
                  <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                </button>

                <form onSubmit={convertLead} className="border border-border bg-surface p-3">
                  <p className="label-mono">Convertir en proyecto</p>
                  <div className="mt-3 flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="label-mono">Título del proyecto *</span>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        required
                        minLength={3}
                        className="min-h-[44px] border border-border bg-background px-3 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="label-mono">Client ID (opcional)</span>
                      <input
                        type="text"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="min-h-[44px] border border-border bg-background px-3 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={convertLoading}
                      className="btn-brutal w-full justify-center"
                    >
                      {convertLoading ? "Convirtiendo…" : "Convertir en proyecto"}
                      <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
                    </button>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
