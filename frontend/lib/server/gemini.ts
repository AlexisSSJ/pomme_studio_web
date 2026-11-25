import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";
export const FALLBACK_GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_INLINE_IMAGES = 6;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_INLINE_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const SYSTEM_INSTRUCTION =
  "Eres el Director Creativo Senior de Pomme Studio, un estudio especializado exclusivamente en branding, dirección creativa, diseño de interiores, documentación ejecutiva y especificaciones FF&E (nunca ejecución de obra ni construcción). Redacta reportes ejecutivos sobrios, precisos, concretos y accionables en español en formato Markdown limpio (sin bloques de código envolventes). Nunca inventes datos ausentes; cuando falte información, señálalo explícitamente en la sección de ambigüedades y puntos a validar.";

export interface BriefReportQuestionInput {
  category: string;
  prompt: string;
  answer: string | null;
  transcription: string | null;
  imageCount: number;
}

export interface BriefReportReferenceInput {
  category: string;
  fileName: string;
  contentType: string | null;
  note: string | null;
}

export interface BriefReportImageInput {
  label: string;
  contentType: string;
  buffer: Buffer;
}

export class GeminiReportError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "GeminiReportError";
    this.statusCode = statusCode;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyGeminiError(err: unknown): {
  statusCode: number;
  retryable: boolean;
  userMessage: string;
} {
  const raw =
    err instanceof Error && err.message
      ? err.message
      : typeof err === "string"
        ? err
        : "Error inesperado al consultar Gemini.";
  const upper = raw.toUpperCase();

  if (
    upper.includes("API_KEY_INVALID") ||
    upper.includes("PERMISSION_DENIED") ||
    upper.includes('"CODE":403') ||
    upper.includes(" 403 ")
  ) {
    return {
      statusCode: 502,
      retryable: false,
      userMessage:
        "La clave de API de Gemini es inválida o no tiene permisos suficientes. Verifica GEMINI_API_KEY en Settings > Secrets.",
    };
  }

  if (
    upper.includes("RESOURCE_EXHAUSTED") ||
    upper.includes('"CODE":429') ||
    upper.includes(" 429 ")
  ) {
    return {
      statusCode: 429,
      retryable: true,
      userMessage:
        "Se alcanzó el límite de cuota de Gemini API. Espera unos segundos o configura una clave con facturación en Settings > Secrets.",
    };
  }

  if (
    upper.includes("UNAVAILABLE") ||
    upper.includes("HIGH DEMAND") ||
    upper.includes("OVERLOADED") ||
    upper.includes('"CODE":503') ||
    upper.includes('"CODE":500') ||
    upper.includes("INTERNAL")
  ) {
    return {
      statusCode: 503,
      retryable: true,
      userMessage:
        "El servicio de Gemini está experimentando alta demanda temporal. Intenta generar el reporte nuevamente en unos segundos.",
    };
  }

  if (upper.includes("NOT_FOUND") || upper.includes('"CODE":404')) {
    return {
      statusCode: 502,
      retryable: false,
      userMessage:
        "El modelo de Gemini configurado no está disponible. Verifica la variable GEMINI_MODEL en el servidor.",
    };
  }

  if (
    upper.includes("FETCH FAILED") ||
    upper.includes("ECONNRESET") ||
    upper.includes("ETIMEDOUT") ||
    upper.includes("TIMEOUT") ||
    upper.includes("TIMED OUT") ||
    upper.includes("ABORT") ||
    upper.includes("ENOTFOUND") ||
    upper.includes("NETWORK")
  ) {
    return {
      statusCode: 504,
      retryable: true,
      userMessage:
        "Error de red o tiempo de espera agotado al conectar con Gemini API. Intenta nuevamente.",
    };
  }

  return {
    statusCode: 502,
    retryable: false,
    userMessage: `No se pudo generar el reporte con IA: ${raw.slice(0, 220)}`,
  };
}

function buildBriefPrompt(params: {
  projectTitle: string;
  scopeType: string | null;
  clientLabel: string | null;
  questions: BriefReportQuestionInput[];
  references: BriefReportReferenceInput[];
  imageLabels: string[];
}): string {
  const scopeLabels: Record<string, string> = {
    branding: "Branding",
    interior: "Diseño de Interiores",
    integral: "Branding + Diseño de Interiores (Integral)",
  };
  const scopeText =
    (params.scopeType && scopeLabels[params.scopeType]) ||
    params.scopeType ||
    "Diseño integral";

  const lines: string[] = [
    "Analiza toda la información recopilada del Brief del cliente y redacta un reporte ejecutivo profesional, claro, preciso y accionable en español usando Markdown limpio (sin bloques de código envolventes).",
    "",
    "### Datos del Proyecto",
    `- Proyecto: ${params.projectTitle}`,
    `- Cliente: ${params.clientLabel || "Sin asignar"}`,
    `- Alcance: ${scopeText}`,
    "",
    "### Respuestas del Cuestionario del Brief",
  ];

  if (params.questions.length === 0) {
    lines.push("- (No hay preguntas registradas en el brief todavía.)");
  } else {
    params.questions.forEach((q, idx) => {
      lines.push(
        `\n**${String(idx + 1).padStart(2, "0")}. [${q.category.toUpperCase()}] ${q.prompt}**`
      );
      lines.push(
        q.answer && q.answer.trim()
          ? `- Respuesta escrita: ${q.answer.trim()}`
          : "- Respuesta escrita: (Sin respuesta escrita)"
      );
      if (q.transcription && q.transcription.trim()) {
        lines.push(`- Transcripción de nota de voz: ${q.transcription.trim()}`);
      }
      if (q.imageCount > 0) {
        lines.push(
          `- Imágenes de referencia adjuntas a esta pregunta: ${q.imageCount}`
        );
      }
    });
  }

  lines.push("\n### Archivos de Referencia Generales");
  if (params.references.length === 0) {
    lines.push("- (No se adjuntaron archivos de referencia adicionales.)");
  } else {
    for (const ref of params.references) {
      const noteText =
        ref.note && ref.note.trim() ? ` — Nota: ${ref.note.trim()}` : "";
      lines.push(
        `- [${ref.category.toUpperCase()}] ${ref.fileName} (${ref.contentType || "archivo"})${noteText}`
      );
    }
  }

  if (params.imageLabels.length > 0) {
    lines.push("\n### Referencias Visuales Adjuntas para Análisis Multimodal");
    params.imageLabels.forEach((label, idx) => {
      lines.push(`- Imagen ${idx + 1}: ${label}`);
    });
  }

  lines.push(
    "",
    "### Estructura Obligatoria del Reporte (usa exactamente estos 4 encabezados H2 en Markdown):",
    "## 01. Resumen Ejecutivo del Proyecto",
    "Síntesis ejecutiva del objetivo de marca/espacio, alcance de diseño y dirección recomendada.",
    "",
    "## 02. Identidad, Valores, Tono de Comunicación y Público Objetivo",
    "Análisis estructurado con viñetas claras sobre pilares de identidad, valores centrales, personalidad/tono verbal y perfil de audiencia o usuario del espacio.",
    "",
    "## 03. Análisis de Referencias Visuales e Insights Clave",
    "Lectura curatorial de las referencias escritas, auditivas y visuales (materialidad, paleta, tipografía, atmósfera, mobiliario/FF&E y referentes editoriales). Si no hubo imágenes adjuntas, indícalo explícitamente y analiza los insumos textuales disponibles.",
    "",
    "## 04. Ambigüedades, Contradicciones y Puntos a Validar con el Cliente",
    "Lista priorizada y accionable de huecos de información, posibles tensiones entre objetivos o decisiones que el equipo debe confirmar con el cliente antes de pasar a la siguiente fase de diseño.",
    "",
    "Reglas de estilo:",
    "- Sé concreto, honesto con lo que falta en el brief y evita relleno genérico.",
    "- No menciones procesos de construcción, obra civil ni montaje físico.",
    "- Devuelve únicamente el contenido Markdown del reporte comenzando por un título H1 `# Reporte Ejecutivo de Brief — <Nombre del Proyecto>`."
  );

  return lines.join("\n");
}

function buildModelConfig(modelName: string) {
  const isGemini4 =
    modelName === "gemini-4-hydrogen" ||
    modelName === "gemini-4-neon" ||
    modelName === "gemini-4-carbon" ||
    modelName === "gemini-4-argon";
  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    ...(isGemini4
      ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
      : {}),
  };
}

export async function generateBriefReportMarkdown(params: {
  projectTitle: string;
  scopeType: string | null;
  clientLabel: string | null;
  questions: BriefReportQuestionInput[];
  references: BriefReportReferenceInput[];
  images: BriefReportImageInput[];
}): Promise<{ markdown: string; modelUsed: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiReportError(
      "El servicio de IA (GEMINI_API_KEY) no está configurado en el servidor.",
      503
    );
  }

  const configuredModel = process.env.GEMINI_MODEL?.trim();
  const primaryModel = configuredModel || DEFAULT_GEMINI_MODEL;
  const candidateModels =
    !configuredModel && primaryModel !== FALLBACK_GEMINI_MODEL
      ? [primaryModel, FALLBACK_GEMINI_MODEL]
      : [primaryModel];

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const selectedImages = params.images
    .filter(
      (img) =>
        ALLOWED_INLINE_IMAGE_MIME.has(img.contentType.toLowerCase()) &&
        img.buffer.length > 0 &&
        img.buffer.length <= MAX_IMAGE_BYTES
    )
    .slice(0, MAX_INLINE_IMAGES);

  const promptText = buildBriefPrompt({
    projectTitle: params.projectTitle,
    scopeType: params.scopeType,
    clientLabel: params.clientLabel,
    questions: params.questions,
    references: params.references,
    imageLabels: selectedImages.map((img) => img.label),
  });

  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: promptText }];

  for (const img of selectedImages) {
    parts.push({
      inlineData: {
        mimeType: img.contentType,
        data: img.buffer.toString("base64"),
      },
    });
  }

  let lastFailure: { statusCode: number; userMessage: string } | null = null;
  const hasFallback = candidateModels.length > 1;

  for (let modelIdx = 0; modelIdx < candidateModels.length; modelIdx++) {
    const model = candidateModels[modelIdx];
    const isLastModel = modelIdx === candidateModels.length - 1;
    // Fail over quickly if the primary model stalls under high demand,
    // so the overall HTTP request stays well within browser/proxy timeouts.
    const maxAttempts = hasFallback && !isLastModel ? 1 : 3;
    const timeoutMs = hasFallback && !isLastModel ? 15_000 : 25_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            ...buildModelConfig(model),
            httpOptions: {
              timeout: timeoutMs,
              headers: {
                "User-Agent": "aistudio-build",
              },
            },
          },
        });

        const text = (response.text ?? "").trim();
        if (!text) {
          throw new GeminiReportError(
            "El modelo de IA devolvió una respuesta vacía al generar el reporte.",
            502
          );
        }

        return { markdown: text, modelUsed: model };
      } catch (err) {
        if (err instanceof GeminiReportError) {
          lastFailure = {
            statusCode: err.statusCode,
            userMessage: err.message,
          };
          break;
        }
        const classified = classifyGeminiError(err);
        lastFailure = {
          statusCode: classified.statusCode,
          userMessage: classified.userMessage,
        };

        if (!classified.retryable) {
          throw new GeminiReportError(
            classified.userMessage,
            classified.statusCode
          );
        }

        if (attempt < maxAttempts) {
          await sleep(900 * attempt);
        }
      }
    }
  }

  throw new GeminiReportError(
    lastFailure?.userMessage || "No se pudo generar el reporte con IA.",
    lastFailure?.statusCode || 502
  );
}
