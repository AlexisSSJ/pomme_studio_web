"use client";

import { useMemo, useRef, useState } from "react";
import { apiFetch, extractDetail } from "@/lib/api";

type MeetingTypeValue = "review" | "survey";

interface Slot {
  start_time: string;
  end_time: string;
}

interface AvailabilityResponse {
  date: string;
  slots: Slot[];
}

interface BookedMeeting {
  id: string;
  project_id: string;
  google_event_id: string | null;
  meet_link: string | null;
  start_time: string;
  end_time: string;
  meeting_type: string;
  status: string;
  created_at: string;
}

const TYPE_OPTIONS: { value: MeetingTypeValue; label: string }[] = [
  { value: "review", label: "Revisión" },
  { value: "survey", label: "Levantamiento en sitio" },
];

export function meetingTypeLabel(value: string): string {
  if (value === "review") return "Revisión";
  if (value === "survey") return "Levantamiento en sitio";
  return value;
}

export function meetingStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    scheduled: "Agendada",
    confirmed: "Confirmada",
    cancelled: "Cancelada",
    completed: "Completada",
    no_show: "No asistió",
  };
  return labels[value] ?? value;
}

function todayInputValue(): string {
  return new Date().toLocaleDateString("en-CA");
}

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

/**
 * Book a review or site-survey meeting for a project: pick a type (and
 * optionally a stage), check availability for a date, then confirm a
 * slot. All touch targets are at least 44x44 px.
 */
export default function MeetingScheduler({
  projectId,
  stages,
  onBooked,
}: {
  projectId: string;
  stages?: { id: string; name: string; order_index: number }[];
  onBooked?: () => void;
}) {
  const [meetingType, setMeetingType] = useState<MeetingTypeValue>("review");
  const [stageId, setStageId] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayInputValue());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [hasChecked, setHasChecked] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [booked, setBooked] = useState<BookedMeeting | null>(null);
  const availabilityRequestSeq = useRef(0);

  const sortedStages = useMemo(
    () => [...(stages ?? [])].sort((a, b) => a.order_index - b.order_index),
    [stages]
  );

  function resetAvailability() {
    availabilityRequestSeq.current += 1;
    setSlots([]);
    setSelectedSlot(null);
    setSlotsLoading(false);
    setSlotsError("");
    setHasChecked(false);
    setBookingError("");
  }

  async function checkAvailability() {
    const requestSeq = ++availabilityRequestSeq.current;
    setSlotsError("");
    setBookingError("");
    setSlots([]);
    setSelectedSlot(null);
    setHasChecked(false);

    if (!selectedDate) {
      setSlotsError("Selecciona una fecha.");
      return;
    }

    setSlotsLoading(true);
    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/meetings/availability?date=${encodeURIComponent(
          selectedDate
        )}`
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (requestSeq !== availabilityRequestSeq.current) return;

      if (res.ok) {
        const availability = data as AvailabilityResponse;
        setSlots(Array.isArray(availability.slots) ? availability.slots : []);
        setHasChecked(true);
      } else {
        setSlotsError(
          extractDetail(
            data,
            "No se pudo consultar la disponibilidad. Intenta más tarde."
          )
        );
      }
    } catch {
      if (requestSeq !== availabilityRequestSeq.current) return;
      setSlotsError("Error de conexión con el servidor");
    } finally {
      if (requestSeq === availabilityRequestSeq.current) {
        setSlotsLoading(false);
      }
    }
  }

  async function bookMeeting() {
    if (booking || !selectedSlot) return;
    setBooking(true);
    setBookingError("");

    const body: {
      meeting_type: MeetingTypeValue;
      start_time: string;
      stage_id?: string;
    } = {
      meeting_type: meetingType,
      start_time: selectedSlot.start_time,
    };
    if (stageId) {
      body.stage_id = stageId;
    }

    try {
      const res = await apiFetch(
        `/api/v1/projects/${projectId}/meetings`,
        { method: "POST", body: JSON.stringify(body) }
      );
      const data: unknown = await res.json().catch(() => ({}));
      if (res.ok) {
        setBooked(data as BookedMeeting);
        resetAvailability();
        onBooked?.();
      } else {
        setBookingError(
          extractDetail(
            data,
            "No se pudo agendar la reunión. Intenta de nuevo."
          )
        );
      }
    } catch {
      setBookingError("Error de conexión con el servidor");
    } finally {
      setBooking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border border-border bg-surface p-4">
      <h2 className="text-lg tracking-tightest">Agendar reunión</h2>

      <label className="flex flex-col gap-1">
        <span className="label-mono">Tipo de reunión</span>
        <select
          value={meetingType}
          onChange={(event) =>
            setMeetingType(event.target.value as MeetingTypeValue)
          }
          className="min-h-[44px] border border-border bg-background px-3 text-sm"
        >
          {TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {sortedStages.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="label-mono">Etapa (opcional)</span>
          <select
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            className="min-h-[44px] border border-border bg-background px-3 text-sm"
          >
            <option value="">Sin etapa específica</option>
            {sortedStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="label-mono">Fecha</span>
        <input
          type="date"
          min={todayInputValue()}
          value={selectedDate}
          onChange={(event) => {
            resetAvailability();
            setBooked(null);
            setSelectedDate(event.target.value);
          }}
          className="min-h-[44px] border border-border bg-background px-3 text-sm"
        />
      </label>

      <button
        type="button"
        onClick={checkAvailability}
        disabled={slotsLoading || !selectedDate}
        className="btn-brutal min-h-[44px] self-start px-3 text-xs"
      >
        {slotsLoading ? "Consultando…" : "Ver disponibilidad"}
        <span className="btn-brutal__arrow" aria-hidden="true">
          ↗
        </span>
      </button>

      {slotsError && (
        <p className="border border-border bg-background p-3 text-sm">
          {slotsError}
        </p>
      )}

      {!slotsLoading && hasChecked && slots.length === 0 && !slotsError && (
        <p className="text-sm">
          No hay horarios disponibles para esta fecha. Prueba con otra.
        </p>
      )}

      {slots.length > 0 && (
        <>
          <p className="label-mono">HORARIOS DISPONIBLES</p>
          <div
            role="radiogroup"
            aria-label="Horarios disponibles"
            className="grid-brutal grid-cols-2 sm:grid-cols-4"
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
                  className={`min-h-[44px] w-full px-3 text-sm ${
                    selected ? "bg-surface font-semibold" : ""
                  }`}
                >
                  {formatSlotTime(slot.start_time)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={bookMeeting}
            disabled={booking || !selectedSlot}
            className="btn-brutal min-h-[44px] self-start px-3 text-xs"
          >
            {booking ? "Agendando…" : "Confirmar reunión"}
            <span className="btn-brutal__arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        </>
      )}

      {bookingError && (
        <p className="border border-border bg-background p-3 text-sm">
          {bookingError}
        </p>
      )}

      {booked && (
        <div className="flex flex-col gap-2 border border-border bg-background p-4">
          <p className="label-mono">
            {meetingTypeLabel(booked.meeting_type)} ·{" "}
            {meetingStatusLabel(booked.status)}
          </p>
          <p className="text-sm font-semibold">
            {formatMeetingDateTime(booked.start_time)}
          </p>
          {booked.meet_link && (
            <a
              href={booked.meet_link}
              target="_blank"
              rel="noreferrer"
              className="btn-brutal min-h-[44px] self-start px-3 text-xs"
            >
              Abrir Google Meet
              <span className="btn-brutal__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
