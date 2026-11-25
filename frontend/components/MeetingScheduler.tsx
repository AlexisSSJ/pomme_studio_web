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
    <div className="brief-editorial">
      <div className="flex flex-col gap-4 rounded-2xl border border-stone-900/10 bg-surface/75 p-5 md:p-6">
        <div className="border-b border-stone-900/10 pb-3">
          <p className="type-tech text-stone-600">Calendario del estudio</p>
          <h2 className="type-subtitle-caps mt-1 text-lg text-stone-900">
            Agendar reunión
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="type-ui text-sm text-stone-600">
              Tipo de reunión
            </span>
            <select
              value={meetingType}
              onChange={(event) =>
                setMeetingType(event.target.value as MeetingTypeValue)
              }
              className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900 transition-colors duration-300 focus:border-stone-900/45"
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {sortedStages.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="type-ui text-sm text-stone-600">
                Etapa (opcional)
              </span>
              <select
                value={stageId}
                onChange={(event) => setStageId(event.target.value)}
                className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900 transition-colors duration-300 focus:border-stone-900/45"
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

          <label className="flex flex-col gap-1.5">
            <span className="type-ui text-sm text-stone-600">Fecha</span>
            <input
              type="date"
              min={todayInputValue()}
              value={selectedDate}
              onChange={(event) => {
                resetAvailability();
                setBooked(null);
                setSelectedDate(event.target.value);
              }}
              className="type-ui min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3 text-sm text-stone-900 transition-colors duration-300 focus:border-stone-900/45"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={checkAvailability}
          disabled={slotsLoading || !selectedDate}
          className="type-ui min-h-[44px] self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {slotsLoading ? "Consultando…" : "Ver disponibilidad ↗"}
        </button>

        {slotsError && (
          <p className="type-ui rounded-xl border border-stone-900/15 bg-background p-4 text-sm text-stone-700">
            {slotsError}
          </p>
        )}

        {!slotsLoading && hasChecked && slots.length === 0 && !slotsError && (
          <p className="type-editorial text-[15px] italic text-stone-600">
            No hay horarios disponibles para esta fecha. Prueba con otra.
          </p>
        )}

        {slots.length > 0 && (
          <div className="space-y-3 border-t border-stone-900/10 pt-4">
            <p className="type-tech text-stone-600">Horarios disponibles</p>
            <div
              role="radiogroup"
              aria-label="Horarios disponibles"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
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
                    className={`type-tech min-h-[44px] w-full rounded-lg border px-3 text-xs transition-colors duration-300 ${
                      selected
                        ? "border-stone-900 bg-stone-900 text-background"
                        : "border-stone-900/15 bg-background text-stone-800 hover:border-stone-900/45"
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
              className="type-ui min-h-[44px] self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {booking ? "Agendando…" : "Confirmar reunión ↗"}
            </button>
          </div>
        )}

        {bookingError && (
          <p className="type-ui rounded-xl border border-stone-900/15 bg-background p-4 text-sm text-stone-700">
            {bookingError}
          </p>
        )}

        {booked && (
          <div className="flex flex-col gap-3 rounded-xl border border-[#5F7161]/40 bg-[#EEF2EC]/75 p-4">
            <p className="type-tech text-[#44544A]">
              {meetingTypeLabel(booked.meeting_type)} ·{" "}
              {meetingStatusLabel(booked.status)}
            </p>
            <p className="type-editorial text-base text-stone-900">
              {formatMeetingDateTime(booked.start_time)}
            </p>
            {booked.meet_link && (
              <a
                href={booked.meet_link}
                target="_blank"
                rel="noreferrer"
                className="type-ui inline-flex min-h-[44px] items-center self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors duration-300 hover:bg-stone-800"
              >
                Abrir Google Meet ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
