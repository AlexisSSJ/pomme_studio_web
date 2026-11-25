import crypto from "crypto";
import { hashPassword } from "./auth";
import { registerDeliverableWithAsset } from "./extensions";
import {
  appendAuditLog,
  findUserByEmail,
  type AppStore,
  type StoredAssetVersion,
  type StoredBriefItem,
  type StoredBriefReport,
  type StoredChangeRequest,
  type StoredProject,
  type StoredProjectAsset,
  type StoredStage,
  type StoredUser,
  type UserRole,
} from "./store";

export interface DevAccountDescriptor {
  role: UserRole;
  email: string;
  full_name: string;
  specialty: string | null;
  label: string;
  summary: string;
}

export const DEV_ACCOUNTS: readonly DevAccountDescriptor[] = [
  {
    role: "SUPER_ADMIN",
    email: "admin.dev@pommestudio.test",
    full_name: "Camila Ríos",
    specialty: "Dirección General",
    label: "Super Admin",
    summary: "Control total: usuarios, pricing, auditoría, reportes IA y visibilidad",
  },
  {
    role: "LEAD_DESIGNER",
    email: "lead.dev@pommestudio.test",
    full_name: "Mateo Solís",
    specialty: "Dirección Creativa & Branding",
    label: "Lead Designer",
    summary: "Configura etapas, subtareas, entregas y visibilidad granular de assets",
  },
  {
    role: "COLLABORATOR",
    email: "collab.dev@pommestudio.test",
    full_name: "Sofía Vega",
    specialty: "Interiorismo & FF&E",
    label: "Collaborator",
    summary: "Gestiona subtareas, sube assets/entregables internos, briefs y FF&E",
  },
  {
    role: "CLIENT",
    email: "cliente.dev@pommestudio.test",
    full_name: "Elena Garza",
    specialty: null,
    label: "Cliente",
    summary: "Portal cliente: responde briefs, acepta etapas, solicita cambios y consulta assets",
  },
];

export function isDevModeEnabled(): boolean {
  if (process.env.ENABLE_DEV_MODE === "false") {
    return false;
  }
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_MODE === "true"
  );
}

function makeArchitecturalSvg(params: {
  code: string;
  title: string;
  subtitle: string;
  swatches: [string, string, string];
}): Buffer {
  const [c1, c2, c3] = params.swatches;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <rect width="800" height="600" fill="#F9FAF4"/>
  <rect x="28" y="28" width="744" height="544" fill="none" stroke="#111111" stroke-width="1.5"/>
  <line x1="28" y1="112" x2="772" y2="112" stroke="#111111" stroke-width="1"/>
  <line x1="28" y1="472" x2="772" y2="472" stroke="#111111" stroke-width="1"/>
  <line x1="520" y1="112" x2="520" y2="472" stroke="#111111" stroke-width="1"/>
  <text x="52" y="76" font-family="monospace" font-size="14" letter-spacing="2" fill="#111111">POMME STUDIO // ${params.code}</text>
  <text x="748" y="76" text-anchor="end" font-family="monospace" font-size="13" fill="#555555">DOCUMENTO DE PRUEBA</text>
  <rect x="52" y="140" width="440" height="220" fill="${c1}" stroke="#111111" stroke-width="1"/>
  <rect x="76" y="164" width="180" height="172" fill="${c2}" stroke="#111111" stroke-width="1"/>
  <rect x="280" y="164" width="188" height="82" fill="${c3}" stroke="#111111" stroke-width="1"/>
  <rect x="280" y="258" width="188" height="78" fill="#F9FAF4" stroke="#111111" stroke-width="1"/>
  <text x="52" y="405" font-family="Georgia, serif" font-size="26" fill="#111111">${params.title}</text>
  <text x="52" y="438" font-family="monospace" font-size="13" fill="#444444">${params.subtitle}</text>
  <rect x="546" y="140" width="200" height="90" fill="${c1}" stroke="#111111" stroke-width="1"/>
  <rect x="546" y="246" width="200" height="90" fill="${c2}" stroke="#111111" stroke-width="1"/>
  <rect x="546" y="352" width="200" height="90" fill="${c3}" stroke="#111111" stroke-width="1"/>
  <text x="52" y="528" font-family="monospace" font-size="12" fill="#111111">RETICULA EDITORIAL · SIN ESCALA DE OBRA · SOLO DIRECCION CREATIVA Y FF&amp;E</text>
</svg>`;
  return Buffer.from(svg, "utf-8");
}

function makeMinimalSamplePdf(title: string, versionLabel: string): Buffer {
  const safeText = `Pomme Studio - ${title} (${versionLabel})`.replace(
    /[()\\]/g,
    " "
  );
  const stream = `BT /F1 14 Tf 54 740 Td (${safeText}) Tj 0 -24 Td (Documento de prueba generado para la Libreria de Assets.) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(stream, "utf-8")} >> stream\n${stream}\nendstream endobj`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf-8"));
    body += `${obj}\n`;
  }
  const xrefPos = Buffer.byteLength(body, "utf-8");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body, "utf-8");
}

const DEV_PROJECT_TITLES = [
  "Casa Bruma — Identidad & Residencia",
  "Atelier Nube — Rebranding Editorial",
  "Galería Piedra — Interiorismo & FF&E",
] as const;

export function isDevSandboxSeeded(store: AppStore): boolean {
  const hasAllUsers = DEV_ACCOUNTS.every((acc) =>
    Boolean(findUserByEmail(store, acc.email))
  );
  if (!hasAllUsers) return false;
  const projectTitles = new Set(
    Array.from(store.projects.values()).map((p) => p.title)
  );
  return DEV_PROJECT_TITLES.every((title) => projectTitles.has(title));
}

export function seedDevSandbox(
  store: AppStore,
  options: { reset?: boolean } = {}
): {
  users: Record<UserRole, StoredUser>;
  projectsCount: number;
} {
  const now = new Date().toISOString();

  if (options.reset) {
    for (const project of Array.from(store.projects.values())) {
      if (
        (DEV_PROJECT_TITLES as readonly string[]).includes(project.title)
      ) {
        const assets = store.projectAssets.get(project.id) ?? [];
        for (const asset of assets) {
          const versions = store.assetVersions.get(asset.id) ?? [];
          for (const v of versions) {
            store.mediaBlobs.delete(v.blob_key);
          }
          store.assetVersions.delete(asset.id);
        }
        const stages = store.stages.get(project.id) ?? [];
        for (const st of stages) {
          store.stageSubtasks.delete(st.id);
          store.changeRequests.delete(st.id);
        }
        const delivs = store.deliverables.get(project.id) ?? [];
        for (const d of delivs) {
          store.deliverableComments.delete(d.id);
        }
        store.deliverables.delete(project.id);
        store.projectAssets.delete(project.id);
        store.briefItems.delete(project.id);
        store.briefReports.delete(project.id);
        store.stages.delete(project.id);
        store.specifications.delete(project.id);
        store.projectMembers.delete(project.id);
        store.projects.delete(project.id);
      }
    }
  }

  // 1. Ensure 4 sandbox users (one per role)
  const usersByRole = {} as Record<UserRole, StoredUser>;
  for (const descriptor of DEV_ACCOUNTS) {
    let existing = findUserByEmail(store, descriptor.email);
    if (!existing) {
      const randomPassword = crypto.randomBytes(24).toString("base64url");
      existing = {
        id: crypto.randomUUID(),
        email: descriptor.email,
        hashed_password: hashPassword(randomPassword),
        full_name: descriptor.full_name,
        specialty: descriptor.specialty,
        role: descriptor.role,
        is_active: true,
        must_change_password: false,
        created_at: now,
        updated_at: now,
      };
      store.users.set(existing.id, existing);
    } else {
      existing.is_active = true;
      existing.must_change_password = false;
      existing.role = descriptor.role;
    }
    usersByRole[descriptor.role] = existing;
  }

  const adminUser = usersByRole.SUPER_ADMIN;
  const leadUser = usersByRole.LEAD_DESIGNER;
  const collabUser = usersByRole.COLLABORATOR;
  const clientUser = usersByRole.CLIENT;

  const existingByTitle = new Map<string, StoredProject>();
  for (const project of store.projects.values()) {
    existingByTitle.set(project.title, project);
  }

  // 2. Project 1: Casa Bruma (Active, Integral, Brief submitted + AI report + Synced Deliverables + Open Change Request)
  if (!existingByTitle.has(DEV_PROJECT_TITLES[0])) {
    const p1Id = crypto.randomUUID();
    const p1: StoredProject = {
      id: p1Id,
      title: DEV_PROJECT_TITLES[0],
      lead_id: null,
      client_id: clientUser.id,
      lead_designer_id: leadUser.id,
      scope_type: "integral",
      status: "active",
      included_rounds: 3,
      remaining_rounds: 2,
      balance_paid: false,
      brief_sent_at: now,
      brief_submitted_at: now,
      created_at: now,
    };
    store.projects.set(p1Id, p1);
    store.projectMembers.set(p1Id, [
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        user_id: leadUser.id,
        assigned_role: "LEAD_DESIGNER",
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        user_id: collabUser.id,
        assigned_role: "COLLABORATOR",
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        user_id: clientUser.id,
        assigned_role: "CLIENT",
        created_at: now,
      },
    ]);

    const p1Stage1Id = crypto.randomUUID();
    const p1Stage2Id = crypto.randomUUID();
    const p1Stage3Id = crypto.randomUUID();

    const p1Stages: StoredStage[] = [
      {
        id: p1Stage1Id,
        project_id: p1Id,
        name: "Exploración de marca y territorio espacial",
        description:
          "Aterrizaje del brief, narrativa de hospitalidad mineral y definición de copy rector ES/EN.",
        order_index: 0,
        status: "approved",
        max_change_requests: 2,
        used_change_requests: 1,
        approved_by: clientUser.id,
        approved_at: now,
        created_at: now,
      },
      {
        id: p1Stage2Id,
        project_id: p1Id,
        name: "Anteproyecto de diseño integral",
        description:
          "Sistema de identidad visual, planos de distribución conceptual y paleta material del salón.",
        order_index: 1,
        status: "active",
        max_change_requests: 2,
        used_change_requests: 1,
        approved_by: null,
        approved_at: null,
        created_at: now,
      },
      {
        id: p1Stage3Id,
        project_id: p1Id,
        name: "Documentación ejecutiva y FF&E",
        description:
          "Planos de diseño definitivos, manual de aplicaciones y catálogo maestro de mobiliario y luminarias.",
        order_index: 2,
        status: "locked",
        max_change_requests: 1,
        used_change_requests: 0,
        approved_by: null,
        approved_at: null,
        created_at: now,
      },
    ];
    store.stages.set(p1Id, p1Stages);
    store.deliverables.set(p1Id, []);
    store.projectAssets.set(p1Id, []);

    store.stageSubtasks.set(p1Stage1Id, [
      {
        id: crypto.randomUUID(),
        stage_id: p1Stage1Id,
        title: "Aterrizar brief y síntesis de entrevistas",
        description: "Consolidar hallazgos del cuestionario y notas de voz.",
        status: "done",
        assigned_to: leadUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        stage_id: p1Stage1Id,
        title: "Entregar copy de marca y manifiesto bilingüe",
        description: "Versión ES/EN para recepción, menús y papelería.",
        status: "done",
        assigned_to: collabUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);

    store.stageSubtasks.set(p1Stage2Id, [
      {
        id: crypto.randomUUID(),
        stage_id: p1Stage2Id,
        title: "Definir retícula editorial y sistema tipográfico",
        description: "Jerarquías para señalética y cartas gastronómicas.",
        status: "done",
        assigned_to: leadUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        stage_id: p1Stage2Id,
        title: "Ajustar plano conceptual de 28 comensales y barra matutina",
        description: "Integrar mesas desmontables para cenas privadas.",
        status: "in_progress",
        assigned_to: collabUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        stage_id: p1Stage2Id,
        title: "Validar luminarias 2700K y acabados de piedra volcánica",
        description: null,
        status: "pending",
        assigned_to: collabUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);

    store.stageSubtasks.set(p1Stage3Id, [
      {
        id: crypto.randomUUID(),
        stage_id: p1Stage3Id,
        title: "Compilar catálogo maestro FF&E con códigos y proveedores",
        description: null,
        status: "pending",
        assigned_to: collabUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        stage_id: p1Stage3Id,
        title: "Cerrar manual ejecutivo de marca y señalética",
        description: null,
        status: "pending",
        assigned_to: leadUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);

    // Synced Deliverables (auto-registered in Librería de Assets without physical duplication!)
    const s1Buf = makeArchitecturalSvg({
      code: "DIR-01",
      title: "Dirección Creativa & Copy — Casa Bruma",
      subtitle: "Etapa 01 aprobada · Narrativa ES/EN y territorios",
      swatches: ["#EFECE6", "#C8BFB0", "#4A463F"],
    });
    const s1Synced = registerDeliverableWithAsset({
      store,
      project: p1,
      stageId: p1Stage1Id,
      actor: leadUser,
      title: "Presentación de Dirección Creativa y Copy",
      fileName: "casa-bruma-direccion-creativa-v1.svg",
      fileExtension: "svg",
      contentType: "image/svg+xml",
      buffer: s1Buf,
      visibility: "client_visible",
      visibleRoles: [],
      visibleUserIds: [],
      changelog: "Entrega final aprobada de Etapa 01",
    });
    s1Synced.deliverable.status = "approved";

    const s2PlanBuf = makeArchitecturalSvg({
      code: "ANT-02",
      title: "Anteproyecto Salón & Sistema Gráfico",
      subtitle: "Etapa 02 en revisión · Planta conceptual + identidad",
      swatches: ["#F9FAF4", "#D9D4C8", "#111111"],
    });
    const s2Synced = registerDeliverableWithAsset({
      store,
      project: p1,
      stageId: p1Stage2Id,
      actor: leadUser,
      title: "Anteproyecto Salón Principal & Retícula",
      fileName: "casa-bruma-anteproyecto-v1.svg",
      fileExtension: "svg",
      contentType: "image/svg+xml",
      buffer: s2PlanBuf,
      visibility: "client_visible",
      visibleRoles: [],
      visibleUserIds: [],
      changelog: "Primera presentación de Anteproyecto para revisión del cliente",
    });
    s2Synced.deliverable.status = "changes_requested";

    // Seed an open Change Request on Stage 2 (client can still add items until team confirms work started!)
    const p1Stage2Cr: StoredChangeRequest = {
      id: crypto.randomUUID(),
      project_id: p1Id,
      stage_id: p1Stage2Id,
      request_number: 1,
      status: "open",
      items: [
        {
          id: crypto.randomUUID(),
          body: "Ampliar el paso entre la barra de café matutina y la mesa comunal para mejorar circulación de servicio.",
          created_by: clientUser.id,
          created_at: now,
        },
        {
          id: crypto.randomUUID(),
          body: "Aumentar el contraste tipográfico en los subtítulos bilingües de la carta de cenas.",
          created_by: clientUser.id,
          created_at: now,
        },
      ],
      requested_by: clientUser.id,
      requested_at: now,
      work_started_by: null,
      work_started_at: null,
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
      updated_deliverable_id: null,
      updated_asset_id: null,
      updated_asset_version_id: null,
    };
    store.changeRequests.set(p1Stage1Id, []);
    store.changeRequests.set(p1Stage2Id, [p1Stage2Cr]);
    store.changeRequests.set(p1Stage3Id, []);

    const refItemId = crypto.randomUUID();
    const refSvg = makeArchitecturalSvg({
      code: "REF-01",
      title: "Referencia Táctil — Casa Bruma",
      subtitle: "Cal mineral, roble ahumado y lino crudo",
      swatches: ["#EFECE6", "#C8BFB0", "#4A463F"],
    });
    store.mediaBlobs.set(`brief-ref:${refItemId}`, {
      buffer: refSvg,
      content_type: "image/svg+xml",
      file_name: "casa-bruma-referencia-materiales.svg",
    });

    const p1BriefItems: StoredBriefItem[] = [
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        item_type: "question",
        category: "branding",
        prompt: "¿Cuál es la esencia de la marca y qué valores debe comunicar?",
        answer:
          "Casa Bruma es una casa de hospitalidad boutique y estudio gastronómico de 12 habitaciones. Queremos transmitir calma mineral, hospitalidad silenciosa, oficio artesanal mexicano contemporáneo y precisión editorial sin caer en lujo ostentoso.",
        note: null,
        file_name: null,
        content_type: null,
        size_bytes: null,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription:
          "Nos gustaría que al abrir el menú o entrar al lobby se sienta la misma serenidad: papel de algodón, luz filtrada y tipografía con carácter arquitectónico.",
        transcription:
          "Nos gustaría que al abrir el menú o entrar al lobby se sienta la misma serenidad: papel de algodón, luz filtrada y tipografía con carácter arquitectónico.",
        response_type: "text",
        client_confirmed: true,
        status: "answered",
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        item_type: "question",
        category: "branding",
        prompt: "¿A qué público objetivo se dirige y cuál debe ser el tono de voz?",
        answer:
          "Viajeros creativos internacionales (30–50 años), arquitectos, diseñadores y comensales locales que valoran el silencio, el diseño honesto y los ingredientes de temporada. Tono sobrio, cálido, editorial y bilingüe (español/inglés).",
        note: null,
        file_name: null,
        content_type: null,
        size_bytes: null,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription: null,
        transcription: null,
        response_type: "text",
        client_confirmed: true,
        status: "answered",
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        item_type: "question",
        category: "interior",
        prompt: "¿Qué atmósferas, materiales y paleta táctil imaginas para el espacio?",
        answer:
          "Estuco de cal color hueso, piedra volcánica cepillada, madera de encino natural y textiles de lino sin teñir. Iluminación indirecta cálida (2700K) con acentos escultóricos en latón envejecido.",
        note: null,
        file_name: null,
        content_type: null,
        size_bytes: null,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription: null,
        transcription: null,
        response_type: "text",
        client_confirmed: true,
        status: "answered",
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        item_type: "question",
        category: "interior",
        prompt: "¿Qué requerimientos funcionales y de mobiliario (FF&E) son prioritarios?",
        answer:
          "Salón principal para 28 comensales con mesas desmontables para cenas privadas, recepción integrada con barra de té/café matutino y curaduría de luminarias de mesa y piezas de mobiliario a medida.",
        note: null,
        file_name: null,
        content_type: null,
        size_bytes: null,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription: null,
        transcription: null,
        response_type: "text",
        client_confirmed: true,
        status: "answered",
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: refItemId,
        project_id: p1Id,
        item_type: "reference",
        category: "interior",
        prompt: null,
        answer: null,
        note: "Paleta preliminar de materiales minerales y textiles deseados",
        file_name: "casa-bruma-referencia-materiales.svg",
        content_type: "image/svg+xml",
        size_bytes: refSvg.length,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription: null,
        transcription: null,
        response_type: null,
        client_confirmed: false,
        status: "answered",
        created_by: clientUser.id,
        created_at: now,
        updated_at: now,
      },
    ];
    store.briefItems.set(p1Id, p1BriefItems);

    const p1Report: StoredBriefReport = {
      id: crypto.randomUUID(),
      project_id: p1Id,
      brief_id: p1Id,
      status: "generated",
      model_used: "gemini-3.1-flash",
      generated_by: leadUser.id,
      updated_by: leadUser.id,
      generated_at: now,
      created_at: now,
      updated_at: now,
      content_markdown: `# Reporte Ejecutivo de Brief — Casa Bruma

## 01. Resumen Ejecutivo del Proyecto
**Casa Bruma** requiere un sistema integral de **branding e interiorismo (FF&E)** que unifique su propuesta de hospitalidad boutique (12 habitaciones) y estudio gastronómico bajo una narrativa de serenidad mineral y precisión editorial.

## 02. Identidad, Valores, Tono de Comunicación y Público Objetivo
- **Pilares de identidad:** Hospitalidad silenciosa, oficio contemporáneo y austeridad cálida.
- **Tono verbal:** Sobrio, editorial y bilingüe (ES/EN), evitando adjetivos grandilocuentes.
- **Público objetivo:** Viajeros creativos internacionales (30–50 años), comunidad de arquitectura/diseño y comensales locales.

## 03. Análisis de Referencias Visuales e Insights Clave
- **Paleta y materialidad:** Estuco de cal hueso, piedra volcánica cepillada, encino natural y lino crudo, con acentos en latón envejecido.
- **Lenguaje gráfico:** Papel de algodón, tipografía serif editorial combinada con índices técnicos en monospace.
- **Iluminación y FF&E:** Temperatura cálida 2700K con luminarias escultóricas y mesas desmontables para 28 comensales.

## 04. Ambigüedades, Contradicciones y Puntos a Validar con el Cliente
1. **Alcance de señalética física:** Confirmar si los directorios exteriores se incluyen en esta documentación ejecutiva.
2. **Operación recepción / barra matutina:** Definir prioridad visual entre check-in y estación de café.
3. **Presupuesto objetivo de FF&E:** Alinear rango estimado por pieza a medida vs. catálogo comercial.`,
    };
    store.briefReports.set(p1Id, p1Report);

    store.specifications.set(p1Id, [
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        category: "furniture",
        name: "Mesa Comedor Bruma 240",
        code: "FFE-MOB-01",
        manufacturer: "Taller Norte",
        finish: "Encino europeo cepillado mate",
        dimensions: "240 × 100 × 75 cm",
        supplier: "Taller Norte MX",
        reference_url: null,
        location: "Salón Gastronómico",
        notes: "Sistema desmontable en 2 módulos para cenas privadas",
        created_by: collabUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p1Id,
        category: "lighting",
        name: "Lámpara de Mesa Monolito",
        code: "FFE-ILU-04",
        manufacturer: "Atelier Luz",
        finish: "Piedra volcánica + latón envejecido (2700K)",
        dimensions: "Ø 22 × 34 cm",
        supplier: "Atelier Luz Studio",
        reference_url: null,
        location: "Mesas de comedor y recepción",
        notes: "Atenuable 10%–100%",
        created_by: collabUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);

    // Additional Centralized Library Assets (plans, contracts, typography, internal notes)
    const asset1Id = crypto.randomUUID();
    const a1v1Id = crypto.randomUUID();
    const a1v2Id = crypto.randomUUID();
    const a1v1Buf = makeArchitecturalSvg({
      code: "TYPO-V1",
      title: "Sistema Tipográfico — v1",
      subtitle: "Propuesta inicial: Amiri + Atkinson Mono",
      swatches: ["#EFECE6", "#D9D4C8", "#111111"],
    });
    const a1v2Buf = makeArchitecturalSvg({
      code: "TYPO-V2",
      title: "Sistema Tipográfico — v2",
      subtitle: "Escala revisada + retícula bilingüe ES/EN",
      swatches: ["#F9FAF4", "#C8BFB0", "#111111"],
    });
    store.mediaBlobs.set(`asset:${asset1Id}:${a1v1Id}`, {
      buffer: a1v1Buf,
      content_type: "image/svg+xml",
      file_name: "casa-bruma-tipografia-v1.svg",
    });
    store.mediaBlobs.set(`asset:${asset1Id}:${a1v2Id}`, {
      buffer: a1v2Buf,
      content_type: "image/svg+xml",
      file_name: "casa-bruma-tipografia-v2.svg",
    });

    const asset2Id = crypto.randomUUID();
    const a2v1Id = crypto.randomUUID();
    const a2v1Pdf = makeMinimalSamplePdf(
      "Planos de Distribucion Salon Casa Bruma",
      "v1"
    );
    store.mediaBlobs.set(`asset:${asset2Id}:${a2v1Id}`, {
      buffer: a2v1Pdf,
      content_type: "application/pdf",
      file_name: "casa-bruma-planta-conceptual-v1.pdf",
    });

    const asset3Id = crypto.randomUUID();
    const a3v1Id = crypto.randomUUID();
    const a3v1Pdf = makeMinimalSamplePdf(
      "Contrato de Servicios de Diseno Casa Bruma",
      "v1"
    );
    store.mediaBlobs.set(`asset:${asset3Id}:${a3v1Id}`, {
      buffer: a3v1Pdf,
      content_type: "application/pdf",
      file_name: "casa-bruma-contrato-diseno.pdf",
    });

    const asset4Id = crypto.randomUUID();
    const a4v1Id = crypto.randomUUID();
    const a4v1Pdf = makeMinimalSamplePdf(
      "Notas Internas de Direccion Creativa",
      "v1"
    );
    store.mediaBlobs.set(`asset:${asset4Id}:${a4v1Id}`, {
      buffer: a4v1Pdf,
      content_type: "application/pdf",
      file_name: "notas-internas-direccion-creativa.pdf",
    });

    const existingP1Assets = store.projectAssets.get(p1Id) ?? [];
    const extraP1Assets: StoredProjectAsset[] = [
      {
        id: asset1Id,
        project_id: p1Id,
        title: "Sistema Tipográfico & Retícula",
        description:
          "Jerarquía tipográfica editorial bilingüe para menús, directorios y señalética.",
        category: "typography_palette",
        visibility: "client_visible",
        visible_roles: [],
        visible_user_ids: [],
        source_stage_id: p1Stage2Id,
        source_deliverable_id: null,
        source_change_request_id: null,
        current_version_number: 2,
        uploaded_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: asset2Id,
        project_id: p1Id,
        title: "Planta Conceptual — Salón 28 Comensales",
        description:
          "Plano de distribución espacial, circulación de servicio y zonificación de mobiliario.",
        category: "plans",
        visibility: "client_visible",
        visible_roles: [],
        visible_user_ids: [],
        source_stage_id: p1Stage2Id,
        source_deliverable_id: null,
        source_change_request_id: null,
        current_version_number: 1,
        uploaded_by: collabUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: asset3Id,
        project_id: p1Id,
        title: "Contrato de Dirección Creativa & Alcance",
        description:
          "Documento contractual firmado (visibilidad personalizada: Lead, Admin y Cliente).",
        category: "contracts",
        visibility: "custom",
        visible_roles: ["LEAD_DESIGNER", "CLIENT"],
        visible_user_ids: [clientUser.id],
        source_stage_id: null,
        source_deliverable_id: null,
        source_change_request_id: null,
        current_version_number: 1,
        uploaded_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: asset4Id,
        project_id: p1Id,
        title: "Notas Internas de Dirección Creativa",
        description:
          "Borrador interno de criterios de revisión (visible únicamente para el equipo).",
        category: "presentations",
        visibility: "internal_only",
        visible_roles: [],
        visible_user_ids: [],
        source_stage_id: null,
        source_deliverable_id: null,
        source_change_request_id: null,
        current_version_number: 1,
        uploaded_by: adminUser.id,
        created_at: now,
        updated_at: now,
      },
    ];
    store.projectAssets.set(p1Id, [...existingP1Assets, ...extraP1Assets]);

    const a1Versions: StoredAssetVersion[] = [
      {
        id: a1v1Id,
        asset_id: asset1Id,
        version_number: 1,
        file_name: "casa-bruma-tipografia-v1.svg",
        file_extension: "svg",
        content_type: "image/svg+xml",
        size_bytes: a1v1Buf.length,
        blob_key: `asset:${asset1Id}:${a1v1Id}`,
        changelog: "Propuesta tipográfica inicial",
        is_current: false,
        uploaded_by: leadUser.id,
        created_at: now,
      },
      {
        id: a1v2Id,
        asset_id: asset1Id,
        version_number: 2,
        file_name: "casa-bruma-tipografia-v2.svg",
        file_extension: "svg",
        content_type: "image/svg+xml",
        size_bytes: a1v2Buf.length,
        blob_key: `asset:${asset1Id}:${a1v2Id}`,
        changelog: "Ajuste de interlineado y jerarquía bilingüe ES/EN",
        is_current: true,
        uploaded_by: leadUser.id,
        created_at: now,
      },
    ];
    store.assetVersions.set(asset1Id, a1Versions);

    store.assetVersions.set(asset2Id, [
      {
        id: a2v1Id,
        asset_id: asset2Id,
        version_number: 1,
        file_name: "casa-bruma-planta-conceptual-v1.pdf",
        file_extension: "pdf",
        content_type: "application/pdf",
        size_bytes: a2v1Pdf.length,
        blob_key: `asset:${asset2Id}:${a2v1Id}`,
        changelog: "Versión inicial de planta conceptual",
        is_current: true,
        uploaded_by: collabUser.id,
        created_at: now,
      },
    ]);

    store.assetVersions.set(asset3Id, [
      {
        id: a3v1Id,
        asset_id: asset3Id,
        version_number: 1,
        file_name: "casa-bruma-contrato-diseno.pdf",
        file_extension: "pdf",
        content_type: "application/pdf",
        size_bytes: a3v1Pdf.length,
        blob_key: `asset:${asset3Id}:${a3v1Id}`,
        changelog: "Contrato firmado",
        is_current: true,
        uploaded_by: leadUser.id,
        created_at: now,
      },
    ]);

    store.assetVersions.set(asset4Id, [
      {
        id: a4v1Id,
        asset_id: asset4Id,
        version_number: 1,
        file_name: "notas-internas-direccion-creativa.pdf",
        file_extension: "pdf",
        content_type: "application/pdf",
        size_bytes: a4v1Pdf.length,
        blob_key: `asset:${asset4Id}:${a4v1Id}`,
        changelog: "Versión inicial interna",
        is_current: true,
        uploaded_by: adminUser.id,
        created_at: now,
      },
    ]);
  }

  // 3. Project 2: Atelier Nube (Active, Branding — Stage 1 ready for Client Review: Accept or Request Changes)
  if (!existingByTitle.has(DEV_PROJECT_TITLES[1])) {
    const p2Id = crypto.randomUUID();
    const p2: StoredProject = {
      id: p2Id,
      title: DEV_PROJECT_TITLES[1],
      lead_id: null,
      client_id: clientUser.id,
      lead_designer_id: leadUser.id,
      scope_type: "branding",
      status: "active",
      included_rounds: 2,
      remaining_rounds: 2,
      balance_paid: false,
      brief_sent_at: now,
      brief_submitted_at: null,
      created_at: now,
    };
    store.projects.set(p2Id, p2);
    store.projectMembers.set(p2Id, [
      {
        id: crypto.randomUUID(),
        project_id: p2Id,
        user_id: leadUser.id,
        assigned_role: "LEAD_DESIGNER",
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p2Id,
        user_id: collabUser.id,
        assigned_role: "COLLABORATOR",
        created_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p2Id,
        user_id: clientUser.id,
        assigned_role: "CLIENT",
        created_at: now,
      },
    ]);

    const p2Stage1Id = crypto.randomUUID();
    const p2Stage2Id = crypto.randomUUID();

    store.stages.set(p2Id, [
      {
        id: p2Stage1Id,
        project_id: p2Id,
        name: "Exploración de marca",
        description:
          "Aterrizar brief, definir territorio verbal/visual y presentar copy de marca para cerámica de autor.",
        order_index: 0,
        status: "active",
        max_change_requests: 2,
        used_change_requests: 0,
        approved_by: null,
        approved_at: null,
        created_at: now,
      },
      {
        id: p2Stage2Id,
        project_id: p2Id,
        name: "Sistema de identidad y aplicaciones",
        description:
          "Logotipo principal, monograma para sello en cerámica, empaques y plantilla de catálogo editorial.",
        order_index: 1,
        status: "locked",
        max_change_requests: 2,
        used_change_requests: 0,
        approved_by: null,
        approved_at: null,
        created_at: now,
      },
    ]);
    store.deliverables.set(p2Id, []);
    store.projectAssets.set(p2Id, []);

    store.stageSubtasks.set(p2Stage1Id, [
      {
        id: crypto.randomUUID(),
        stage_id: p2Stage1Id,
        title: "Aterrizar brief y auditoría de marca actual",
        description: "Revisar respuestas y posicionamiento frente a colecciones.",
        status: "done",
        assigned_to: leadUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        stage_id: p2Stage1Id,
        title: "Entregar copy de marca y territorios editoriales",
        description: "Manifiesto, tagline y tono de voz para catálogo.",
        status: "in_progress",
        assigned_to: collabUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);
    store.stageSubtasks.set(p2Stage2Id, [
      {
        id: crypto.randomUUID(),
        stage_id: p2Stage2Id,
        title: "Diseñar logotipo principal y monograma para sello",
        description: null,
        status: "pending",
        assigned_to: leadUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        stage_id: p2Stage2Id,
        title: "Desarrollar sistema de cajas, etiquetas y tarjetas de cuidados",
        description: null,
        status: "pending",
        assigned_to: collabUser.id,
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);
    store.changeRequests.set(p2Stage1Id, []);
    store.changeRequests.set(p2Stage2Id, []);

    // Published deliverable on Stage 1 synced automatically to Librería de Assets
    const p2DelivBuf = makeArchitecturalSvg({
      code: "EXP-01",
      title: "Exploración de Marca — Atelier Nube",
      subtitle: "Territorios editoriales y copy de marca v1",
      swatches: ["#EFECE6", "#9A9389", "#222222"],
    });
    registerDeliverableWithAsset({
      store,
      project: p2,
      stageId: p2Stage1Id,
      actor: leadUser,
      title: "Presentación Exploración de Marca & Copy",
      fileName: "atelier-nube-exploracion-marca-v1.svg",
      fileExtension: "svg",
      contentType: "image/svg+xml",
      buffer: p2DelivBuf,
      visibility: "client_visible",
      visibleRoles: [],
      visibleUserIds: [],
      changelog: "Propuesta inicial de exploración de marca lista para revisión del cliente",
    });

    store.briefItems.set(p2Id, [
      {
        id: crypto.randomUUID(),
        project_id: p2Id,
        item_type: "question",
        category: "branding",
        prompt: "¿Qué problema actual busca resolver el rebranding de Atelier Nube?",
        answer:
          "Nuestra identidad anterior se siente demasiado genérica frente a colecciones de cerámica de autor. Necesitamos una voz más editorial y reconocible en empaques y catálogo digital.",
        note: null,
        file_name: null,
        content_type: null,
        size_bytes: null,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription: null,
        transcription: null,
        response_type: "text",
        client_confirmed: true,
        status: "answered",
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p2Id,
        item_type: "question",
        category: "branding",
        prompt: "¿Qué soportes y entregables gráficos son prioritarios para el lanzamiento?",
        answer:
          "Logotipo principal y monograma para sello en cerámica, sistema de cajas y etiquetas, tarjetas de cuidados y plantilla de catálogo PDF.",
        note: null,
        file_name: null,
        content_type: null,
        size_bytes: null,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription: null,
        transcription: null,
        response_type: "text",
        client_confirmed: true,
        status: "answered",
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
      {
        id: crypto.randomUUID(),
        project_id: p2Id,
        item_type: "question",
        category: "general",
        prompt: "¿Existen restricciones de color, tipografía o fechas límite clave?",
        answer: null,
        note: null,
        file_name: null,
        content_type: null,
        size_bytes: null,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription: null,
        transcription: null,
        response_type: null,
        client_confirmed: false,
        status: "pending",
        created_by: leadUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);

    store.specifications.set(p2Id, []);
  }

  // 4. Project 3: Galería Piedra (Draft, Interior — ready to test assigning lead, activating, sending brief)
  if (!existingByTitle.has(DEV_PROJECT_TITLES[2])) {
    const p3Id = crypto.randomUUID();
    const p3: StoredProject = {
      id: p3Id,
      title: DEV_PROJECT_TITLES[2],
      lead_id: null,
      client_id: clientUser.id,
      lead_designer_id: null,
      scope_type: "interior",
      status: "draft",
      included_rounds: 2,
      remaining_rounds: 2,
      balance_paid: false,
      brief_sent_at: null,
      brief_submitted_at: null,
      created_at: now,
    };
    store.projects.set(p3Id, p3);
    store.projectMembers.set(p3Id, [
      {
        id: crypto.randomUUID(),
        project_id: p3Id,
        user_id: clientUser.id,
        assigned_role: "CLIENT",
        created_at: now,
      },
    ]);
    const p3Stage1Id = crypto.randomUUID();
    const p3Stage2Id = crypto.randomUUID();
    store.stages.set(p3Id, [
      {
        id: p3Stage1Id,
        project_id: p3Id,
        name: "Dirección creativa y recorrido espacial",
        description: "Concepto expositivo, secuencia de salas e iluminación.",
        order_index: 0,
        status: "active",
        max_change_requests: 2,
        used_change_requests: 0,
        approved_by: null,
        approved_at: null,
        created_at: now,
      },
      {
        id: p3Stage2Id,
        project_id: p3Id,
        name: "Documentación ejecutiva y FF&E",
        description: "Especificaciones de mobiliario expositivo y luminarias.",
        order_index: 1,
        status: "locked",
        max_change_requests: 1,
        used_change_requests: 0,
        approved_by: null,
        approved_at: null,
        created_at: now,
      },
    ]);
    store.stageSubtasks.set(p3Stage1Id, [
      {
        id: crypto.randomUUID(),
        stage_id: p3Stage1Id,
        title: "Definir guion espacial y zonificación de salas",
        description: null,
        status: "pending",
        assigned_to: null,
        created_by: adminUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);
    store.stageSubtasks.set(p3Stage2Id, []);
    store.changeRequests.set(p3Stage1Id, []);
    store.changeRequests.set(p3Stage2Id, []);
    store.deliverables.set(p3Id, []);

    store.briefItems.set(p3Id, [
      {
        id: crypto.randomUUID(),
        project_id: p3Id,
        item_type: "question",
        category: "interior",
        prompt: "¿Qué recorrido expositivo e iluminación arquitectónica imaginas para la galería?",
        answer: null,
        note: null,
        file_name: null,
        content_type: null,
        size_bytes: null,
        image_url: null,
        images: [],
        audio_url: null,
        audio_transcription: null,
        transcription: null,
        response_type: null,
        client_confirmed: false,
        status: "pending",
        created_by: adminUser.id,
        created_at: now,
        updated_at: now,
      },
    ]);
    store.specifications.set(p3Id, []);
    store.projectAssets.set(p3Id, []);
  }

  // 5. Sample leads if empty
  if (store.leads.size === 0) {
    const lead1Id = crypto.randomUUID();
    store.leads.set(lead1Id, {
      id: lead1Id,
      contact_name: "Lucía Méndez — Café Terracota",
      email: "lucia@cafeterracota.test",
      service_type: "integral",
      space_type: "Cafetería de especialidad",
      area_m2: "110",
      budget_range: "$25,000 - $40,000 USD",
      status: "new",
      created_at: now,
    });
    const lead2Id = crypto.randomUUID();
    store.leads.set(lead2Id, {
      id: lead2Id,
      contact_name: "Diego Navarro — Hotel Alba",
      email: "diego@hotelalba.test",
      service_type: "branding",
      space_type: "Hotel boutique",
      area_m2: null,
      budget_range: "$15,000 - $25,000 USD",
      status: "proposal_sent",
      created_at: now,
    });
  }

  appendAuditLog(store, {
    actor_user_id: adminUser.id,
    action: "dev.sandbox_seeded",
    entity_type: "system",
    entity_id: null,
    metadata_json: {
      reset: Boolean(options.reset),
      projects_count: store.projects.size,
    },
  });

  return {
    users: usersByRole,
    projectsCount: store.projects.size,
  };
}
