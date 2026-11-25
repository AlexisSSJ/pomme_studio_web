"use client";

import { useParams } from "next/navigation";
import ProjectAssetsLibrary from "@/components/ProjectAssetsLibrary";

export default function PortalProjectAssetsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";

  return <ProjectAssetsLibrary projectId={projectId} mode="portal" />;
}
