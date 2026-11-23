# pomme_studio_web

Plataforma de branding y diseño de interiores: front-office público, portal de
clientes y back-office interno. El estudio vende únicamente diseño, dirección
creativa, documentación ejecutiva y especificaciones (FF&E).

## Arquitectura

- **Backend**: FastAPI + SQLAlchemy + Alembic (`backend/`).
- **Frontend**: Next.js 14 (`frontend/`).
- **Migraciones**: revisiones en `backend/alembic/versions/` (cabeza actual `0009`).

## Operaciones del brief

### Normalización de datos heredados (producción / Railway)

La normalización idempotente de briefs heredados corre **automáticamente en cada
deploy**: el `CMD` del contenedor (`backend/Dockerfile`) ejecuta
`alembic upgrade head && python scripts/seed_admin.py && uvicorn ...`, de modo que
la migración `0009_normalize_brief_data` se aplica **antes** de que la API
arranque. `0009` repara el casing de los enums, deriva `status` / `category` /
`item_type` / `response_type`, restaura prompts vacíos, sincroniza transcripciones
y reconcilia imágenes heredadas con `brief_item_images`. Es idempotente:
re-ejecutarla no altera las filas ya reparadas.

Los valores `_missing_` de los enums protegen la validación de Pydantic y los
payloads de la API, **no** las lecturas ORM de SQLAlchemy: una fila heredada con
valores en mayúscula puede leerse tal cual desde la BD. La reparación de esos
valores heredados la garantiza la migración `0009` en cada deploy
(`alembic upgrade head` antes de `uvicorn`), no los `_missing_`.

Comando manual (útil tras importar datos o para verificar) — **desde `backend/`**:

```bash
railway run python scripts/normalize_briefs.py
```

El script imprime un reporte **ANTES** y **DESPUÉS** con el conteo de cinco
anomalías (`invalid_status`, `missing_prompt`, `missing_response_type_with_media`,
`unsynced_transcriptions`, `legacy_images_without_child`), más
`images_copied` / `image_urls_rewritten`, todo en una sola transacción. En una
segunda ejecución todos los contadores quedan en `0`.

> Nota: en SQLite la cadena completa de migraciones no se puede replayar por una
> limitación preexistente de `0002`. Para inspeccionar solo `0009` en modo offline:
> `cd backend && alembic upgrade 0008:0009 --sql`.

### Transcripción de audio (configuración)

Ver `.env.example` para las cuatro variables:

| Variable | Uso |
| --- | --- |
| `TRANSCRIPTION_PROVIDER` | Etiqueta del proveedor para operadores (solo documentación). |
| `TRANSCRIPTION_API_KEY` | Credencial del endpoint compatible con OpenAI. **Vacía desactiva la transcripción.** |
| `TRANSCRIPTION_API_URL` | Endpoint multipart (por defecto `https://api.openai.com/v1/audio/transcriptions`). |
| `TRANSCRIPTION_MODEL` | Modelo enviado en el campo `model` (por defecto `whisper-1`). |

Con API key, el audio se transcribe y el texto se guarda en `transcription` /
`audio_transcription`. **Sin API key el fallback es limpio**: el audio se guarda
igual, no se realiza ninguna llamada externa y el texto queda vacío para que el
**cliente lo edite manualmente** en el portal. No se expone ningún error al
cliente.

### Límites multimedia del brief

- Cada pregunta acepta **hasta 2 imágenes de referencia**; el tercer upload
  responde **409 Conflict**.
- Cada imagen tiene su endpoint individual de borrado
  (`DELETE .../brief/items/{item_id}/images/{image_id}`) y se puede consultar por
  separado (`.../images/{image_id}/media`), con zoom en el visor del portal sin
  depender de `hover`.

### Notificaciones al equipo

Al completarse el brief se emite el evento **`brief.completed`** para el equipo
del proyecto (**Lead Designer + Collaborators activos**). Las notificaciones se
muestran en la **campana** del admin y del portal, y cada cambio queda registrado
en `audit_logs`.

### Plantilla automática del brief

Al crear un proyecto se siembra automáticamente una plantilla de brief acorde al
scope (**branding**, **interior** o **integral**). La plantilla cubre únicamente
entregables de **diseño**: dirección creativa, documentación ejecutiva y
especificaciones FF&E.

## Verificación local

```bash
python3 -m pytest tests/backend -q
(cd frontend && npx tsc --noEmit && npm run build)
(cd backend && alembic heads && alembic history)
```
