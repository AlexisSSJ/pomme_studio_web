"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import ProjectSidebar from "@/components/ProjectSidebar";
import PageTransition from "@/components/PageTransition";

interface ProjectSummary {
  id: string;
  title: string;
  status: string;
}

export default function PortalProjectLayout({
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

  const base = `/portal/projects/${projectId}`;
  const items = [
    { href: base, label: "Resumen" },
    { href: `${base}/brief`, label: "Brief" },
    { href: `${base}/etapas`, label: "Etapas" },
    { href: `${base}/especificaciones`, label: "Catálogo FF&E" },
    { href: `${base}/assets`, label: "Librería de Assets" },
    { href: `${base}/reuniones`, label: "Reuniones" },
  ];

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
      <ProjectSidebar
        basePath={base}
        title={project?.title ?? "Proyecto"}
        status={project?.status}
        items={items}
      />
      <div className="min-w-0 flex-1">
        <PageTransition>{children}</PageTransition>
      </div>
    </div>
  );
}
