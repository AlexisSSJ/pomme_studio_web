"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import DeliverableViewer from "@/components/DeliverableViewer";

export default function EntregablePage() {
  const params = useParams<{ projectId: string; deliverableId: string }>();
  const projectId = params?.projectId ?? "";
  const deliverableId = params?.deliverableId ?? "";

  return (
    <section className="brief-editorial">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-stone-900/15 pb-6">
        <div>
          <p className="type-tech text-stone-600">Revisión con pines</p>
          <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
            Entregable
          </h1>
        </div>
        <Link
          href={`/portal/projects/${projectId}/etapas`}
          className="type-ui inline-flex min-h-[44px] items-center rounded-lg border border-stone-900/20 bg-background px-4 py-2 text-xs text-stone-700 transition-colors duration-300 hover:bg-stone-900 hover:text-background"
        >
          Volver a etapas ↗
        </Link>
      </div>
      <DeliverableViewer
        projectId={projectId}
        deliverableId={deliverableId}
        canReview
      />
    </section>
  );
}
