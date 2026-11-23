"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import DeliverableViewer from "@/components/DeliverableViewer";

export default function EntregablePage() {
  const params = useParams<{ projectId: string; deliverableId: string }>();
  const projectId = params?.projectId ?? "";
  const deliverableId = params?.deliverableId ?? "";

  return (
    <section>
      <h1 className="type-title text-xl">Entregable</h1>
      <Link
        href={`/portal/projects/${projectId}/etapas`}
        className="btn-brutal mt-4 inline-flex min-h-[44px] px-3 text-xs"
      >
        Volver a etapas
        <span className="btn-brutal__arrow" aria-hidden="true">
          ↗
        </span>
      </Link>
      <div className="mt-4">
        <DeliverableViewer
          projectId={projectId}
          deliverableId={deliverableId}
          canReview
        />
      </div>
    </section>
  );
}
