"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useProtectedMediaUrl } from "@/lib/useProtectedMediaUrl";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * WhatsApp-style voice note in the editorial palette: circular play/pause,
 * seekable thin progress line and mono time counters. Native <audio> API,
 * no dependencies. Used inside .brief-editorial (portal and admin brief).
 */
export default function VoiceNotePlayer({ url }: { url: string }) {
  const src = useProtectedMediaUrl(url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fixingDurationRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  if (!src) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone-500">
        Cargando audio…
      </p>
    );
  }

  const progress =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play().catch(() => setPlaying(false));
    }
  }

  function handleSeek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-stone-900/15 bg-[#FAF8F5] px-3 py-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          // MediaRecorder webm often reports Infinity until fully scanned:
          // seek to the end once to force the real duration, then rewind.
          if (!Number.isFinite(audio.duration)) {
            fixingDurationRef.current = true;
            audio.currentTime = 1e101;
          } else {
            setDuration(audio.duration);
          }
        }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          if (fixingDurationRef.current) {
            if (Number.isFinite(audio.duration)) {
              fixingDurationRef.current = false;
              setDuration(audio.duration);
              audio.currentTime = 0;
              setCurrentTime(0);
            }
            return;
          }
          setCurrentTime(audio.currentTime);
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pausar nota de voz" : "Reproducir nota de voz"}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[#FAF8F5] transition-colors duration-300 hover:bg-stone-800"
      >
        {playing ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="4.5" y="3.5" width="2.5" height="9" />
            <rect x="9" y="3.5" width="2.5" height="9" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5 3.5v9l7.5-4.5z" />
          </svg>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(event) => handleSeek(Number(event.target.value))}
          aria-label="Posición de la nota de voz"
          className="voice-note-seek w-full"
          style={{ "--seek-progress": `${progress}%` } as CSSProperties}
        />
        <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-stone-500">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
