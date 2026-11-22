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
  return new Date(iso).toLocaleString(undefined, {
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meetingsRes, stagesRes] = await Promise.all([
        apiFetch(`/api/v1/projects/${projectId}/meetings`),
        apiFetch(`/api/v1/projects/${projectId}/stages`),
      ]);

      if (meetingsRes.ok) {
        setMeetings(await meetingsRes.json());
      } else {
        const data: unknown = await meetingsRes.json().catch(() => ({}));
        setMessage(extractDetail(data, "Error al cargar las reuniones"));
      }

      if (stagesRes.ok) {
        const stages: StageOption[] = await stagesRes.json();
        setStages(
          stages
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
    <section>
      <h1 className="text-xl tracking-tightest">Reuniones</h1>

      {message && (
        <p className="mt-4 border border-border bg-surface p-3 text-sm">
          {message}
        </p>
      )}

      <h2 className="mt-6 text-lg tracking-tightest">Reuniones agendadas</h2>
      {loading && meetings.length === 0 && !message ? (
        <p className="mt-3 text-sm">Cargando…</p>
      ) : meetings.length === 0 && !message ? (
        <p className="mt-3 text-sm">Todavía no hay reuniones agendadas.</p>
      ) : (
        <div className="grid-brutal mt-3">
          {meetings.map((meeting) => (
            <div key={meeting.id} className="flex flex-col gap-3 p-4">
              <p className="label-mono">
                {meetingTypeLabel(meeting.meeting_type)} ·{" "}
                {meetingStatusLabel(meeting.status)}
              </p>
              <p className="text-sm font-semibold">
                {formatMeetingDateTime(meeting.start_time)}
              </p>
              {meeting.meet_link && (
                <a
                  href={meeting.meet_link}
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
          ))}
        </div>
      )}

      <div className="mt-6">
        <MeetingScheduler
          projectId={projectId}
          stages={stages}
          onBooked={load}
        />
      </div>
    </section>
  );
}
