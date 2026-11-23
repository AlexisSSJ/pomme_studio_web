"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import ProjectSidebar from "@/components/ProjectSidebar";

interface ProjectSummary {
  id: string;
  title: string;
  status: string;
}

export default function AdminProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";
  const [project, setProject] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/v1/projects/${projectId}`)
      .then(async (res) => {
        if (!cancelled && res.ok) {
          setProject(await res.json());
        }
      })
      .catch(() => {
        // Sidebar still renders with a fallback title.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const base = `/admin/projects/${projectId}`;
  const items = [
    { href: base, label: "Resumen" },
    { href: `${base}/brief`, label: "BRIEF ↗" },
    { href: `${base}/moodboard`, label: "Moodboard" },
    { href: `${base}/etapas`, label: "Etapas" },
    { href: `${base}/especificaciones`, label: "Especificaciones" },
  ];

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
      <ProjectSidebar
        basePath={base}
        title={project?.title ?? "Proyecto"}
        status={project?.status}
        items={items}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
