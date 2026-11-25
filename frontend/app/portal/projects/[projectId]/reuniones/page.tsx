"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, extractDetail } from "@/lib/api";
import MeetingScheduler, {
  meetingStatusLabel,
  meetingTypeLabel,
} from "@/components/MeetingScheduler";

interface Meeting {
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

interface StageOption {
  id: string;
  name: string;
  order_index: number;
}

function formatMeetingDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReunionesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meetingsRes, stagesRes] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}/meetings`),
        apiFetch(`/api/v1/projects/${projectId}/stages`),
      ]);

      if (meetingsRes.ok) {
        const list = (await meetingsRes.json()) as Meeting[];
        setMeetings(list);
      } else {
        const data: unknown = await meetingsRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar las reuniones"));
      }

      if (stagesRes.ok) {
        const stageList: StageOption[] = await stagesRes.json();
        setStages(
          stageList
            .map((stage) => ({
              id: stage.id,
              name: stage.name,
              order_index: stage.order_index,
            }))
            .sort((a, b) => a.order_index - b.order_index)
        );
      }
    } catch {
      setMessage("Error de conexión con el servidor");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="brief-editorial space-y-8">
      <div className="flex flex-col gap-5 border-b border-stone-900/15 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-tech text-stone-500">05 · Sesiones del proyecto</p>
          <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
            Reuniones
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setShowScheduler((prev) => !prev)}
          className="type-ui min-h-[44px] shrink-0 whitespace-nowrap self-start rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 sm:self-auto"
        >
          {showScheduler ? "Cerrar agenda" : "+ Agendar reunión"}
        </button>
      </div>

      {message && (
        <p className="animate-slide-down type-ui rounded-xl border border-stone-900/15 bg-surface/75 px-4 py-3 text-sm text-stone-700">
          {message}
        </p>
      )}

      {showScheduler && (
        <div className="animate-panel-enter">
          <MeetingScheduler
            projectId={projectId}
            stages={stages}
            onBooked={() => {
              setShowScheduler(false);
              load();
            }}
          />
        </div>
      )}

      {/* Scheduled Meetings List */}
      <div className="rounded-2xl border border-stone-900/15 bg-background shadow-editorial">
        <div className="flex items-baseline justify-between border-b border-stone-900/10 px-6 py-4 md:px-7">
          <p className="type-tech text-stone-500">Reuniones agendadas</p>
          <span className="type-tech tabular-nums text-stone-400">
            {meetings.length}
          </span>
        </div>

        {loading && meetings.length === 0 && !message ? (
          <p className="type-ui px-6 py-6 text-sm text-stone-600 md:px-7">
            Cargando reuniones…
          </p>
        ) : meetings.length === 0 && !message ? (
          <div className="flex flex-col items-start justify-between gap-4 px-6 py-7 sm:flex-row sm:items-center md:px-7">
            <p className="type-editorial text-[15px] italic text-stone-600">
              Todavía no hay reuniones agendadas para este proyecto.
            </p>
            {!showScheduler && (
              <button
                type="button"
                onClick={() => setShowScheduler(true)}
                className="type-ui min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-800 transition-colors hover:bg-stone-900 hover:text-background"
              >
                Agendar primera sesión ↗
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-stone-900/10">
            {meetings.map((meeting) => {
              const isPositive =
                meeting.status === "confirmed" ||
                meeting.status === "completed";
              return (
                <div
                  key={meeting.id}
                  className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between md:px-7"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="type-tech text-stone-600">
                        {meetingTypeLabel(meeting.meeting_type)}
                      </span>
                      <span aria-hidden="true" className="text-stone-300">
                        ·
                      </span>
                      <span
                        className={`type-tech ${
                          isPositive ? "text-[#44544A]" : "text-stone-500"
                        }`}
                      >
                        {meetingStatusLabel(meeting.status)}
                      </span>
                    </div>
                    <p className="type-editorial text-lg capitalize text-stone-900">
                      {formatMeetingDateTime(meeting.start_time)}
                    </p>
                  </div>
                  {meeting.meet_link && (
                    <a
                      href={meeting.meet_link}
                      target="_blank"
                      rel="noreferrer"
                      className="type-ui inline-flex min-h-[42px] shrink-0 whitespace-nowrap items-center self-start rounded-lg bg-stone-900 px-4 py-2 text-xs text-background transition-colors hover:bg-stone-800 sm:self-center"
                    >
                      Abrir Google Meet ↗
                    </a>
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
