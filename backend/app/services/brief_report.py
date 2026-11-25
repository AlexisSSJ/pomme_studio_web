"""AI executive brief report generation powered by Gemini (server-side only)."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Sequence

import httpx

from ..core.config import settings

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

SYSTEM_INSTRUCTION = (
    "Eres la dirección estratégica de Pomme Studio, un estudio de branding, "
    "dirección creativa, documentación ejecutiva y especificaciones FF&E "
    "(no ejecutamos obra física). "
    "Redacta reportes ejecutivos sobrios, precisos y accionables en español, "
    "en formato Markdown limpio. Nunca inventes datos que no estén en el brief; "
    "cuando falte información, señálalo explícitamente en la sección de "
    "ambigüedades y puntos a validar."
)


class BriefReportGenerationError(RuntimeError):
    """Raised when the AI provider is unconfigured or fails to generate a report."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class BriefImageInput:
    label: str
    mime_type: str
    data: bytes | None = None
    size_bytes: int | None = None


@dataclass(frozen=True)
class BriefQuestionInput:
    index: int
    category: str
    prompt: str
    answer: str | None
    transcription: str | None
    client_confirmed: bool
    image_labels: tuple[str, ...] = ()


@dataclass(frozen=True)
class BriefReferenceInput:
    category: str
    file_name: str
    content_type: str | None
    note: str | None


def build_brief_report_prompt(
    *,
    project_title: str,
    scope_type: str | None,
    client_label: str | None,
    questions: Sequence[BriefQuestionInput],
    references: Sequence[BriefReferenceInput],
) -> str:
    """Assemble the structured prompt covering every question, transcription, and reference."""
    lines: list[str] = [
        f"Proyecto: {project_title}",
        f"Alcance (scope): {scope_type or 'No especificado'}",
        f"Cliente: {client_label or 'No especificado'}",
        "",
        "### Respuestas del cuestionario del Brief",
    ]
    if not questions:
        lines.append("- (Aún no hay preguntas registradas en el brief.)")
    else:
        for q in questions:
            status_tag = "Confirmada por cliente" if q.client_confirmed else "Sin sello final"
            lines.append(
                f"{q.index:02d}. [{q.category.upper()}] {q.prompt} ({status_tag})"
            )
            if q.answer and q.answer.strip():
                lines.append(f"   - Respuesta escrita: {q.answer.strip()}")
            if q.transcription and q.transcription.strip():
                lines.append(f"   - Transcripción de nota de voz: {q.transcription.strip()}")
            if q.image_labels:
                lines.append(
                    f"   - Imágenes adjuntas: {', '.join(q.image_labels)}"
                )
            if (
                not (q.answer and q.answer.strip())
                and not (q.transcription and q.transcription.strip())
                and not q.image_labels
            ):
                lines.append("   - (Sin respuesta registrada)")

    lines.append("")
    lines.append("### Referencias y archivos adjuntos")
    if not references:
        lines.append("- (Sin referencias adjuntas.)")
    else:
        for ref in references:
            note_suffix = f" — Nota: {ref.note.strip()}" if ref.note and ref.note.strip() else ""
            lines.append(
                f"- [{ref.category.upper()}] {ref.file_name} ({ref.content_type or 'archivo'}){note_suffix}"
            )

    lines.extend(
        [
            "",
            "Genera un reporte ejecutivo en Markdown con EXACTAMENTE estas 5 secciones principales (usando encabezados `## `):",
            "## 01. Resumen ejecutivo del proyecto",
            "## 02. Identidad, valores, tono de comunicación y público objetivo",
            "## 03. Análisis de referencias visuales e insights clave",
            "## 04. Ambigüedades, contradicciones y puntos a validar con el cliente",
            "## 05. Un task list de preguntas o puntos a aclarar con el cliente.",
            "",
            "Reglas de formato:",
            "- Usa listas claras con viñetas (`- `) y conclusiones concretas orientadas a diseño, dirección creativa, documentación ejecutiva y especificaciones FF&E.",
            "- No incluyas actividades de ejecución de obra ni construcción física.",
            "- Cierra con una breve lista de próximos pasos recomendados antes de pasar a la siguiente fase.",
        ]
    )
    return "\n".join(lines)


async def generate_brief_report_markdown(
    *,
    project_title: str,
    scope_type: str | None,
    client_label: str | None,
    questions: Sequence[BriefQuestionInput],
    references: Sequence[BriefReferenceInput],
    images: Sequence[BriefImageInput] = (),
) -> tuple[str, str]:
    """Call Gemini server-side and return ``(markdown_report, model_name)``."""
    api_key = settings.GEMINI_API_KEY.strip()
    if not api_key:
        raise BriefReportGenerationError(
            "GEMINI_API_KEY no está configurada en el servidor.",
            status_code=503,
        )

    prompt_text = build_brief_report_prompt(
        project_title=project_title,
        scope_type=scope_type,
        client_label=client_label,
        questions=questions,
        references=references,
    )

    parts: list[dict[str, object]] = [{"text": prompt_text}]
    # Include up to 6 inline images (capped at 3 MiB each) for multimodal visual analysis.
    attached = 0
    for image in images:
        if attached >= 6:
            break
        if (
            image.data
            and image.mime_type.startswith("image/")
            and image.mime_type != "image/svg+xml"
            and len(image.data) <= 3 * 1024 * 1024
        ):
            parts.append({"text": f"Referencia visual adjunta: {image.label}"})
            parts.append(
                {
                    "inlineData": {
                        "mimeType": image.mime_type,
                        "data": base64.b64encode(image.data).decode("ascii"),
                    }
                }
            )
            attached += 1

    configured_model = settings.GEMINI_MODEL.strip()
    primary_model = configured_model or "gemini-4-hydrogen"
    fallback_model = "gemini-3.1-flash-lite"
    candidate_models = (
        [primary_model, fallback_model]
        if not configured_model and primary_model != fallback_model
        else [primary_model]
    )

    import asyncio

    last_error: BriefReportGenerationError | None = None
    async with httpx.AsyncClient(timeout=60.0) as client:
        for model_name in candidate_models:
            url = f"{GEMINI_API_BASE}/{model_name}:generateContent"
            payload: dict[str, object] = {
                "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
                "contents": [{"role": "user", "parts": parts}],
            }
            if model_name in {
                "gemini-4-hydrogen",
                "gemini-4-neon",
                "gemini-4-carbon",
                "gemini-4-argon",
            }:
                payload["generationConfig"] = {
                    "thinkingConfig": {"thinkingLevel": "LOW"}
                }

            for attempt in range(1, 3):
                try:
                    response = await client.post(
                        url,
                        params={"key": api_key},
                        headers={"User-Agent": "aistudio-build"},
                        json=payload,
                    )
                except httpx.HTTPError as exc:
                    last_error = BriefReportGenerationError(
                        f"No se pudo conectar con Gemini API: {exc}",
                        status_code=504,
                    )
                    if attempt < 2:
                        await asyncio.sleep(0.75 * attempt)
                    continue

                if response.status_code >= 400:
                    detail = "Error al generar reporte con Gemini API."
                    try:
                        body = response.json()
                        err_msg = body.get("error", {}).get("message")
                        if isinstance(err_msg, str) and err_msg.strip():
                            detail = f"Gemini API respondió {response.status_code}: {err_msg}"
                    except Exception:
                        pass

                    if response.status_code in {429, 500, 503}:
                        last_error = BriefReportGenerationError(
                            "El servicio de Gemini está experimentando alta demanda temporal. Intenta nuevamente en unos segundos."
                            if response.status_code in {500, 503}
                            else "Se alcanzó el límite de cuota de Gemini API. Intenta nuevamente más tarde.",
                            status_code=response.status_code,
                        )
                        if attempt < 2:
                            await asyncio.sleep(0.75 * attempt)
                        continue

                    raise BriefReportGenerationError(detail, status_code=502)

                data = response.json()
                candidates = data.get("candidates") or []
                text_chunks: list[str] = []
                if candidates:
                    content_parts = (candidates[0].get("content") or {}).get("parts") or []
                    for part in content_parts:
                        text = part.get("text")
                        if isinstance(text, str) and text.strip():
                            text_chunks.append(text.strip())

                report_md = "\n\n".join(text_chunks).strip()
                if not report_md:
                    last_error = BriefReportGenerationError(
                        "Gemini API devolvió una respuesta vacía.",
                        status_code=502,
                    )
                    break

                return report_md, model_name

    raise last_error or BriefReportGenerationError(
        "No se pudo generar el reporte con IA.",
        status_code=502,
    )
