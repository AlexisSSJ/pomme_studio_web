"use client";

import { useMemo, useRef, useState } from "react";
import { apiFetch, extractDetail } from "@/lib/api";

type Phase = "form" | "schedule" | "confirmed";

type ServiceType = "branding" | "interior" | "integral";
type SpaceType = "residential" | "commercial" | "hospitality" | "office";
type BudgetRange =
  | "under_10k"
  | "10k_25k"
  | "25k_50k"
  | "50k_100k"
  | "over_100k";

interface LeadResponse {
  id: string;
  contact_name: string;
  email: string;
  service_type: ServiceType;
  space_type: SpaceType | null;
  area_m2: string | null;
  budget_range: BudgetRange | null;
  status: string;
  created_at: string;
}

interface Slot {
  start_time: string;
  end_time: string;
}

interface MeetingResponse {
  id: string;
  lead_id: string;
  project_id: string | null;
  start_time: string;
  end_time: string;
  meeting_type: string;
  status: string;
  meet_link: string | null;
}

const SERVICE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: "branding", label: "Branding" },
  { value: "interior", label: "Diseño interior" },
  { value: "integral", label: "Integral" },
];

const SPACE_OPTIONS: { value: SpaceType; label: string }[] = [
  { value: "residential", label: "Residencial" },
  { value: "commercial", label: "Comercial" },
  { value: "hospitality", label: "Hotelería" },
  { value: "office", label: "Oficina" },
];

const BUDGET_OPTIONS: { value: BudgetRange; label: string }[] = [
  { value: "under_10k", label: "Menos de $10,000 USD" },
  { value: "10k_25k", label: "$10,000 – $25,000 USD" },
  { value: "25k_50k", label: "$25,000 – $50,000 USD" },
  { value: "50k_100k", label: "$50,000 – $100,000 USD" },
  { value: "over_100k", label: "Más de $100,000 USD" },
];

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMeetingDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayInputValue(): string {
  return new Date().toLocaleDateString("en-CA");
}

export default function DiagnosticoPage() {
  const [phase, setPhase] = useState<Phase>("form");

  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType | "">("");
  const [spaceType, setSpaceType] = useState<SpaceType | "">("");
  const [areaM2, setAreaM2] = useState("");
  const [budgetRange, setBudgetRange] = useState<BudgetRange | "">("");

  const [lead, setLead] = useState<LeadResponse | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [selectedDate, setSelectedDate] = useState<string>(todayInputValue());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [hasCheckedAvailability, setHasCheckedAvailability] = useState(false);
  const availabilityRequestSeq = useRef(0);

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");

  const [meeting, setMeeting] = useState<MeetingResponse | null>(null);

  const showArea = serviceType === "interior" || serviceType === "integral";

  const canSubmit = useMemo(() => {
    if (!contactName.trim() || !email.trim() || !serviceType) return false;
    if (showArea) {
      const area = parseFloat(areaM2);
      if (!area || area <= 0) return false;
    }
    return true;
  }, [contactName, email, serviceType, showArea, areaM2]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setFormError("");
    setSubmitting(true);

    const body: {
      contact_name: string;
      email: string;
      service_type: ServiceType;
      space_type?: SpaceType;
      area_m2?: number;
      budget_range?: BudgetRange;
    } = {
      contact_name: contactName.trim(),
      email: email.trim(),
      service_type: serviceType as ServiceType,
    };

    if (spaceType) body.space_type = spaceType;
    if (budgetRange) body.budget_range = budgetRange;

    if (showArea) {
      const area = parseFloat(areaM2);
      if (!area || area <= 0) {
        setFormError("El área debe ser mayor a 0 m² para este servicio.");
        setSubmitting(false);
        return;
      }
      body.area_m2 = area;
    }

    try {
      const res = await apiFetch("/api/v1/leads", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => ({}));

      if (res.ok) {
        setLead(data as LeadResponse);
        setPhase("schedule");
      } else {
        setFormError(
          extractDetail(data, "No se pudo enviar el formulario. Intenta de nuevo.")
        );
      }
    } catch {
      setFormError("Error de conexión con el servidor");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckAvailability() {
    const requestSeq = ++availabilityRequestSeq.current;
    const requestedDate = selectedDate;
    setSlotsError("");
    setSlots([]);
    setSelectedSlot(null);
    setBookingError("");
    setHasCheckedAvailability(false);

    if (!requestedDate) {
      setSlotsLoading(false);
      setSlotsError("Selecciona una fecha.");
      return;
    }

    setSlotsLoading(true);

    try {
      const res = await apiFetch(
        `/api/v1/leads/availability?date=${encodeURIComponent(requestedDate)}`
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (requestSeq !== availabilityRequestSeq.current) return;

      if (
        res.ok &&
        data !== null &&
        typeof data === "object" &&
        "slots" in data &&
        Array.isArray(data.slots)
      ) {
        setSlots(data.slots as Slot[]);
        setHasCheckedAvailability(true);
      } else {
        setSlotsError(
          extractDetail(
            data,
            "No pudimos consultar la disponibilidad. Intenta más tarde."
          )
        );
      }
    } catch {
      if (requestSeq !== availabilityRequestSeq.current) return;
      setSlotsError("Error de conexión con el servidor");
    } finally {
      if (requestSeq === availabilityRequestSeq.current) setSlotsLoading(false);
    }
  }

  async function handleConfirmMeeting() {
    if (!lead || !selectedSlot) return;

    setBookingError("");
    setBookingLoading(true);

    try {
      const res = await apiFetch(`/api/v1/leads/${lead.id}/meetings`, {
        method: "POST",
        body: JSON.stringify({ start_time: selectedSlot.start_time }),
      });
      const data: unknown = await res.json().catch(() => ({}));

      if (res.ok) {
        setMeeting(data as MeetingResponse);
        setPhase("confirmed");
      } else {
        setBookingError(
          extractDetail(data, "No se pudo confirmar la llamada. Intenta de nuevo.")
        );
      }
    } catch {
      setBookingError("Error de conexión con el servidor");
    } finally {
      setBookingLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-4 pb-10 pt-2 sm:px-6">
      <header className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 border-b border-border py-3">
        <a
          href="/"
          className="text-[15px] font-semibold tracking-tightest"
        >
          Pomme Studio
        </a>
        <span className="label-mono">Diagnóstico de proyecto</span>
      </header>

      <section aria-labelledby="diagnostico-title" className="mt-8">
        <p className="label-mono">Discovery Call</p>
        <h1
          id="diagnostico-title"
          className="type-title mt-3 max-w-[18ch] text-[32px] leading-[0.95] sm:text-[44px]"
        >
          Diagnóstico del proyecto
        </h1>
        <p className="type-editorial mt-4 max-w-[52ch] text-sm leading-relaxed">
          Cuéntanos el reto, el tipo de espacio y el alcance estimado. Te
          mostraremos disponibilidad para una llamada de descubrimiento de 30
          minutos.
        </p>
      </section>

      {phase === "form" && (
        <form onSubmit={handleSubmit} className="mt-8">
          <div className="grid-brutal grid-brutal--2">
            {/* 01 / Contacto */}
            <div className="p-5 sm:p-6">
              <p className="label-mono">01 / Contacto</p>
              <div className="mt-4 flex flex-col gap-4">
                <label className="flex flex-col gap-1">
                  <span className="type-ui text-xs">Nombre</span>
                  <input
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="min-h-[44px] border border-border bg-background px-3 text-sm"
                    placeholder="Nombre completo"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="type-ui text-xs">Correo electrónico</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="min-h-[44px] border border-border bg-background px-3 text-sm"
                    placeholder="hola@ejemplo.com"
                  />
                </label>
              </div>
            </div>

            {/* 02 / Servicio */}
            <div className="p-5 sm:p-6">
              <p className="label-mono">02 / Servicio</p>
              <div className="mt-4 flex flex-col gap-4">
                <label className="flex flex-col gap-1">
                  <span className="type-ui text-xs">Tipo de servicio</span>
                  <select
                    required
                    value={serviceType}
                    onChange={(e) =>
                      setServiceType(e.target.value as ServiceType)
                    }
                    className="min-h-[44px] border border-border bg-background px-3 text-sm"
                  >
                    <option value="">Selecciona un servicio</option>
                    {SERVICE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="type-ui text-xs">Tipo de espacio</span>
                  <select
                    value={spaceType}
                    onChange={(e) =>
                      setSpaceType(e.target.value as SpaceType | "")
                    }
                    className="min-h-[44px] border border-border bg-background px-3 text-sm"
                  >
                    <option value="">Selecciona un espacio</option>
                    {SPACE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* 03 / Alcance */}
            <div className="p-5 sm:p-6">
              <p className="label-mono">03 / Alcance</p>
              <div className="mt-4 flex flex-col gap-4">
                {showArea && (
                  <label className="flex flex-col gap-1">
                    <span className="type-ui text-xs">Área aproximada (m²)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required={showArea}
                      value={areaM2}
                      onChange={(e) => setAreaM2(e.target.value)}
                      className="min-h-[44px] border border-border bg-background px-3 text-sm"
                      placeholder="Ej. 120"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className="type-ui text-xs">Rango de inversión</span>
                  <select
                    value={budgetRange}
                    onChange={(e) =>
                      setBudgetRange(e.target.value as BudgetRange | "")
                    }
                    className="min-h-[44px] border border-border bg-background px-3 text-sm"
                  >
                    <option value="">Selecciona un rango</option>
                    {BUDGET_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Submit */}
            <div className="flex flex-col justify-between gap-4 p-5 sm:p-6">
              <p className="label-mono">Enviar</p>
              <div className="flex flex-col gap-3">
                <button
                  type="submit"
                  disabled={submitting || !canSubmit}
                  className="btn-brutal w-full disabled:opacity-50"
                >
                  {submitting ? "Cargando…" : "Continuar a disponibilidad"}
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
                {formError && (
                  <p className="text-sm leading-relaxed text-foreground">
                    {formError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </form>
      )}

      {phase === "schedule" && lead && (
        <section aria-labelledby="agenda-title" className="mt-8">
          <div className="border-b border-border pb-2">
            <p className="label-mono">04 / Agenda</p>
            <h2
              id="agenda-title"
              className="type-subtitle-caps mt-2 text-xl"
            >
              Selecciona fecha y hora
            </h2>
          </div>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1">
              <span className="type-ui text-xs">Fecha</span>
              <input
                type="date"
                min={todayInputValue()}
                value={selectedDate}
                onChange={(e) => {
                  availabilityRequestSeq.current += 1;
                  setSelectedDate(e.target.value);
                  setSlots([]);
                  setSelectedSlot(null);
                  setSlotsLoading(false);
                  setSlotsError("");
                  setHasCheckedAvailability(false);
                  setBookingError("");
                }}
                className="min-h-[44px] border border-border bg-background px-3 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={handleCheckAvailability}
              disabled={slotsLoading || !selectedDate}
              className="btn-brutal disabled:opacity-50"
            >
              {slotsLoading ? "Cargando…" : "Ver disponibilidad"}
              <span className="btn-brutal__arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          </div>

          {slotsLoading && (
            <p className="mt-6 text-sm">Cargando…</p>
          )}

          {slotsError && (
            <p className="mt-4 text-sm leading-relaxed">{slotsError}</p>
          )}

          {!slotsLoading && slots.length > 0 && (
            <>
              <div
                role="radiogroup"
                aria-label="Horarios disponibles"
                className="grid-brutal grid-cols-2 sm:grid-cols-4 mt-6"
              >
                {slots.map((slot, index) => {
                  const selected = selectedSlot?.start_time === slot.start_time;
                  return (
                    <button
                      key={`${slot.start_time}-${index}`}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSelectedSlot(slot)}
                      className={`type-tech min-h-[44px] w-full px-3 text-sm ${
                        selected ? "bg-surface" : "bg-background"
                      }`}
                    >
                      {formatSlotTime(slot.start_time)}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={handleConfirmMeeting}
                  disabled={bookingLoading || !selectedSlot}
                  className="btn-brutal disabled:opacity-50"
                >
                  {bookingLoading ? "Cargando…" : "Confirmar Discovery Call"}
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
                {bookingError && (
                  <p className="text-sm leading-relaxed">{bookingError}</p>
                )}
              </div>
            </>
          )}

          {!slotsLoading && hasCheckedAvailability && slots.length === 0 && !slotsError && selectedDate && (
            <p className="mt-6 text-sm leading-relaxed">
              No hay horarios disponibles para esta fecha. Prueba con otra.
            </p>
          )}
        </section>
      )}

      {phase === "confirmed" && meeting && (
        <section aria-labelledby="confirmada-title" className="mt-8">
          <div className="border border-border bg-surface p-5 sm:p-8">
            <p className="label-mono">04 / Confirmada</p>
            <h2
              id="confirmada-title"
              className="type-title mt-3 text-[24px] leading-[1.05] sm:text-[32px]"
            >
              Discovery Call agendada
            </h2>
            <p className="mt-4 text-sm leading-relaxed">
              Te esperamos el{" "}
              <strong className="type-tech">
                {formatMeetingDateTime(meeting.start_time)}
              </strong>
              .
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              {meeting.meet_link && (
                <a
                  href={meeting.meet_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-brutal"
                >
                  Unirse a Google Meet
                  <span className="btn-brutal__arrow" aria-hidden="true">
                    ↗
                  </span>
                </a>
              )}
              <a
                href="/"
                className="btn-brutal btn-brutal--surface"
              >
                Volver al inicio
                <span className="btn-brutal__arrow" aria-hidden="true">
                  ↗
                </span>
              </a>
            </div>
          </div>
        </section>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 pb-2">
        <p className="label-mono">Pomme Studio</p>
        <p className="label-mono opacity-60">
          Branding · Interiores · FF&amp;E
        </p>
      </footer>
    </main>
  );
}
