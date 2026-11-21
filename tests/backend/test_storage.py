"""Tests for the local media storage service and upload validation."""

from pathlib import Path
from uuid import uuid4

import pytest

from backend.app.api.deps import get_storage
from backend.app.core.config import ROOT_DIR, Settings
from backend.app.services.storage import (
    BRIEF_REFERENCE_CONTENT_TYPES,
    MAX_UPLOAD_BYTES,
    MOODBOARD_CONTENT_TYPES,
    LocalStorage,
    UploadTooLargeError,
    UploadValidationError,
)

PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-png-payload"


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    """A LocalStorage rooted at the pytest temporary directory."""
    return LocalStorage(tmp_path)


@pytest.mark.asyncio
async def test_save_writes_bytes_under_project_dir(
    storage: LocalStorage, tmp_path: Path
):
    project_id = uuid4()

    key = await storage.save(
        project_id, PNG_BYTES, "image/png", BRIEF_REFERENCE_CONTENT_TYPES
    )

    assert key.startswith(f"{project_id}/")
    assert key.endswith(".png")
    saved = tmp_path / key
    assert saved.is_file()
    assert saved.read_bytes() == PNG_BYTES


@pytest.mark.asyncio
async def test_save_rejects_oversize(storage: LocalStorage):
    with pytest.raises(UploadTooLargeError):
        await storage.save(
            uuid4(),
            b"x" * (MAX_UPLOAD_BYTES + 1),
            "image/png",
            BRIEF_REFERENCE_CONTENT_TYPES,
        )


@pytest.mark.asyncio
async def test_save_rejects_disallowed_type(storage: LocalStorage):
    project_id = uuid4()

    with pytest.raises(UploadValidationError):
        await storage.save(project_id, b"<html></html>", "text/html", MOODBOARD_CONTENT_TYPES)

    # PDFs are valid brief references but not moodboard pins.
    with pytest.raises(UploadValidationError):
        await storage.save(project_id, b"%fake-pdf", "application/pdf", MOODBOARD_CONTENT_TYPES)

    key = await storage.save(
        project_id, b"%fake-pdf", "application/pdf", BRIEF_REFERENCE_CONTENT_TYPES
    )
    assert key.endswith(".pdf")


def test_resolve_rejects_traversal(storage: LocalStorage):
    project_id = uuid4()
    invalid_keys = (
        "../escape.png",
        f"{project_id}/../../etc/passwd",
        "/abs/path.png",
    )

    for key in invalid_keys:
        with pytest.raises(UploadValidationError, match="Invalid storage key"):
            storage.resolve(key)


@pytest.mark.asyncio
async def test_delete_removes_file_and_is_idempotent(storage: LocalStorage):
    key = await storage.save(
        uuid4(), PNG_BYTES, "image/png", BRIEF_REFERENCE_CONTENT_TYPES
    )
    assert storage.resolve(key).is_file()

    await storage.delete(key)
    assert not storage.resolve(key).exists()

    # Deleting a second time must not raise (missing_ok semantics).
    await storage.delete(key)


@pytest.mark.asyncio
async def test_delete_rejects_invalid_key(storage: LocalStorage):
    with pytest.raises(UploadValidationError, match="Invalid storage key"):
        await storage.delete("../escape.png")


def test_media_root_defaults_to_repo_media():
    assert Settings(_env_file=None).MEDIA_ROOT == str(ROOT_DIR / "media")


def test_get_storage_returns_local_storage_at_media_root():
    service = get_storage()

    assert isinstance(service, LocalStorage)
    assert service.root == Path(Settings(_env_file=None).MEDIA_ROOT)
