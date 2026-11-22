"""Local filesystem storage for uploaded project media.

Files are written under one directory per project (``<root>/<project_id>/``)
using server-generated names, so client filenames are never trusted: the
extension is derived from the validated content type. Storage keys are
always validated against the root to reject absolute paths and traversal
attempts before any filesystem access.
"""

from pathlib import Path
from uuid import UUID, uuid4

import anyio

# Hard upload ceiling shared by every media endpoint.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Content types accepted for brief reference uploads (images + PDF).
BRIEF_REFERENCE_CONTENT_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}
)
# Content types accepted for brief question multimodal responses (images + audio).
BRIEF_RESPONSE_CONTENT_TYPES = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/x-m4a",
    }
)
# Content types accepted for moodboard pins (images only).
MOODBOARD_CONTENT_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif"}
)
# Server-side content type -> extension mapping (never trust client names).
CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
}


class UploadValidationError(ValueError):
    """Raised when an upload has an unsupported type or an invalid storage key."""


class UploadTooLargeError(ValueError):
    """Raised when an upload exceeds ``MAX_UPLOAD_BYTES``."""


class LocalStorage:
    """Stores project media on the local filesystem under ``root``."""

    def __init__(self, root: Path) -> None:
        self.root = root

    async def save(
        self,
        project_id: UUID,
        data: bytes,
        content_type: str,
        allowed_types: frozenset[str],
    ) -> str:
        """Validate and persist ``data``, returning its storage key.

        Raises ``UploadTooLargeError`` when the payload exceeds the size
        ceiling and ``UploadValidationError`` for disallowed content types.
        """
        if len(data) > MAX_UPLOAD_BYTES:
            raise UploadTooLargeError(
                f"Upload exceeds the maximum of {MAX_UPLOAD_BYTES} bytes"
            )
        if content_type not in allowed_types:
            raise UploadValidationError(f"Content type not allowed: {content_type}")
        extension = CONTENT_TYPE_EXTENSIONS.get(content_type)
        if extension is None:
            raise UploadValidationError(f"Unknown content type: {content_type}")

        storage_key = f"{project_id}/{uuid4().hex}{extension}"
        path = self.resolve(storage_key)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        await anyio.to_thread.run_sync(_write)
        return storage_key

    def resolve(self, storage_key: str) -> Path:
        """Return the absolute path for ``storage_key`` within the root.

        Rejects absolute keys and any key that would escape the root
        (path traversal) with ``UploadValidationError("Invalid storage key")``.
        """
        if Path(storage_key).is_absolute():
            raise UploadValidationError("Invalid storage key")
        root = self.root.resolve()
        candidate = (root / storage_key).resolve()
        if not candidate.is_relative_to(root):
            raise UploadValidationError("Invalid storage key")
        return candidate

    async def delete(self, storage_key: str) -> None:
        """Remove the file for ``storage_key``; missing files are ignored.

        Invalid keys raise ``UploadValidationError`` (via ``resolve``).
        """
        path = self.resolve(storage_key)

        def _unlink() -> None:
            path.unlink(missing_ok=True)

        await anyio.to_thread.run_sync(_unlink)
