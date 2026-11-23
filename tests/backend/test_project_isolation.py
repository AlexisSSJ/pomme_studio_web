"""Cross-project isolation tests for brief and moodboard endpoints.

Members of project B must never reach project A's endpoints (403), and
ids of items that live in B must look like 404s under A's paths — never
like authorization leaks or cross-project mutations.
"""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import get_storage
from backend.app.main import app
from backend.app.models import (
    BriefCategory,
    BriefItem,
    BriefItemType,
    Moodboard,
    MoodboardComment,
    MoodboardItem,
    Project,
    User,
)
from backend.app.services.storage import LocalStorage


@pytest.fixture
def media_storage(tmp_path: Path) -> LocalStorage:
    """Serve uploads from a per-test media directory."""
    storage = LocalStorage(tmp_path / "media")
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# Every brief and moodboard endpoint, as (method, path template, JSON body,
# request kind). `{item_id}` placeholders are filled with random ids.
FOREIGN_ENDPOINTS = [
    pytest.param("GET", "/brief", None, "json", id="brief-list"),
    pytest.param(
        "POST",
        "/brief/questions",
        {"prompt": "¿Pregunta?", "category": "general"},
        "json",
        id="brief-question",
    ),
    pytest.param(
        "PATCH",
        "/brief/items/{item_id}",
        {"answer": "Respuesta"},
        "json",
        id="brief-answer",
    ),
    pytest.param("POST", "/brief/references", None, "brief-upload", id="brief-reference"),
    pytest.param("GET", "/brief/items/{item_id}/file", None, "json", id="brief-file"),
    pytest.param("GET", "/moodboard", None, "json", id="moodboard-list"),
    pytest.param("GET", "/moodboard/boards", None, "json", id="moodboard-boards-list"),
    pytest.param(
        "POST",
        "/moodboard/boards",
        {"title": "Board ajeno"},
        "json",
        id="moodboard-board-create",
    ),
    pytest.param(
        "PATCH",
        "/moodboard/boards/{board_id}",
        {"layout_variant": "atelier_grid"},
        "json",
        id="moodboard-board-patch",
    ),
    pytest.param(
        "DELETE",
        "/moodboard/boards/{board_id}",
        None,
        "json",
        id="moodboard-board-delete",
    ),
    pytest.param(
        "GET",
        "/moodboard/boards/{board_id}/items",
        None,
        "json",
        id="moodboard-board-items",
    ),
    pytest.param(
        "POST",
        "/moodboard/boards/{board_id}/items",
        None,
        "moodboard-upload",
        id="moodboard-board-upload",
    ),
    pytest.param("DELETE", "/moodboard/items/{item_id}", None, "json", id="moodboard-delete"),
    pytest.param(
        "GET", "/moodboard/items/{item_id}/file", None, "json", id="moodboard-file"
    ),
    pytest.param(
        "POST",
        "/moodboard/items/{item_id}/comments",
        {"comment": "Nota"},
        "json",
        id="moodboard-comment-create",
    ),
    pytest.param(
        "DELETE",
        "/moodboard/items/{item_id}/comments/{comment_id}",
        None,
        "json",
        id="moodboard-comment-delete",
    ),
    pytest.param(
        "GET",
        "/moodboard/items/{item_id}/comments",
        None,
        "json",
        id="moodboard-comment-list",
    ),
]

# (caller label, project fixture name): the caller has no access to the
# target project — either a member of the other project or unassigned.
FOREIGN_CALLERS = [
    pytest.param("other_client", "active_project", id="b-client-on-a"),
    pytest.param("client", "other_project", id="a-client-on-b"),
    pytest.param("collaborator", "other_project", id="a-collaborator-on-b"),
    pytest.param("collaborator_two", "active_project", id="unassigned-on-a"),
]


def _foreign_request(
    client: TestClient,
    method: str,
    path: str,
    token: str,
    body: dict | None,
    kind: str,
):
    """Send one request against a foreign project path."""
    headers = auth(token)
    if kind == "brief-upload":
        return client.post(
            path,
            files={"file": ("ref.png", b"\x89PNG-fake-bytes", "image/png")},
            data={"category": "interior"},
            headers=headers,
        )
    if kind == "moodboard-upload":
        return client.post(
            path,
            files={"file": ("pin.png", b"\x89PNG-fake-bytes", "image/png")},
            data={"title": "Pin ajeno", "sort_order": "0"},
            headers=headers,
        )
    if method == "GET":
        return client.get(path, headers=headers)
    if method == "DELETE":
        return client.delete(path, headers=headers)
    if method == "PATCH":
        return client.patch(path, json=body, headers=headers)
    return client.post(path, json=body, headers=headers)


@pytest.mark.asyncio
@pytest.mark.parametrize("caller,target_name", FOREIGN_CALLERS)
@pytest.mark.parametrize("method,path_template,body,kind", FOREIGN_ENDPOINTS)
async def test_foreign_member_gets_403(
    client: TestClient,
    active_project: Project,
    other_project: Project,
    other_client_token: str,
    client_token: str,
    collaborator_token: str,
    collaborator_two_token: str,
    caller: str,
    target_name: str,
    method: str,
    path_template: str,
    body: dict | None,
    kind: str,
):
    """Every brief/moodboard endpoint rejects members of the other project."""
    tokens = {
        "other_client": other_client_token,
        "client": client_token,
        "collaborator": collaborator_token,
        "collaborator_two": collaborator_two_token,
    }
    project = active_project if target_name == "active_project" else other_project
    path_params = {
        "item_id": uuid.uuid4(),
        "board_id": uuid.uuid4(),
        "comment_id": uuid.uuid4(),
    }
    path = (
        f"/api/v1/projects/{project.id}"
        f"{path_template.format(**path_params)}"
    )

    response = _foreign_request(client, method, path, tokens[caller], body, kind)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_cross_project_item_ids_404(
    client: TestClient,
    db_session: AsyncSession,
    active_project: Project,
    other_project: Project,
    other_client_user: User,
    client_token: str,
    collaborator_token: str,
):
    """Valid members of A get 404 for B's item ids under A's paths."""
    foreign_question = BriefItem(
        id=uuid.uuid4(),
        project_id=other_project.id,
        item_type=BriefItemType.QUESTION,
        category=BriefCategory.GENERAL,
        prompt="¿Pregunta ajena?",
        created_by=other_client_user.id,
    )
    foreign_reference = BriefItem(
        id=uuid.uuid4(),
        project_id=other_project.id,
        item_type=BriefItemType.REFERENCE,
        category=BriefCategory.INTERIOR,
        file_name="ref.png",
        content_type="image/png",
        size_bytes=16,
        storage_key=f"{other_project.id}/foreign.png",
        created_by=other_client_user.id,
    )
    foreign_board = Moodboard(
        id=uuid.uuid4(),
        project_id=other_project.id,
        title="Board ajeno",
        created_by=other_client_user.id,
    )
    foreign_piece = MoodboardItem(
        id=uuid.uuid4(),
        project_id=other_project.id,
        moodboard_id=foreign_board.id,
        title="Pin ajeno",
        file_name="pin.png",
        content_type="image/png",
        size_bytes=16,
        storage_key=f"{other_project.id}/foreign-pin.png",
        created_by=other_client_user.id,
    )
    db_session.add_all(
        [foreign_question, foreign_reference, foreign_board, foreign_piece]
    )
    await db_session.commit()

    base = f"/api/v1/projects/{active_project.id}"

    # Brief: A's client cannot touch B's items through A's path.
    response = client.patch(
        f"{base}/brief/items/{foreign_question.id}",
        json={"answer": "Respuesta invasora"},
        headers=auth(client_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Brief item not found"

    response = client.get(
        f"{base}/brief/items/{foreign_reference.id}/file",
        headers=auth(client_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Brief item not found"

    # Moodboard: same rule for team writes/reads and member comments.
    piece_path = f"{base}/moodboard/items/{foreign_piece.id}"

    response = client.delete(piece_path, headers=auth(collaborator_token))
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    response = client.get(f"{piece_path}/file", headers=auth(collaborator_token))
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    response = client.get(f"{piece_path}/comments", headers=auth(collaborator_token))
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    response = client.post(
        f"{piece_path}/comments",
        json={"comment": "Nota invasora"},
        headers=auth(client_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    response = client.delete(
        f"{piece_path}/comments/{uuid.uuid4()}", headers=auth(client_token)
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard item not found"

    # Boards: B's board id reads as missing under A's paths.
    board_path = f"{base}/moodboard/boards/{foreign_board.id}"

    response = client.get(f"{board_path}/items", headers=auth(collaborator_token))
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard not found"

    response = client.patch(
        board_path, json={"title": "Board invadido"}, headers=auth(collaborator_token)
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard not found"

    response = client.delete(board_path, headers=auth(collaborator_token))
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard not found"

    response = client.post(
        f"{board_path}/items",
        files={"file": ("pin.png", b"\x89PNG-fake-bytes", "image/png")},
        data={"title": "Pin invasor", "sort_order": "0"},
        headers=auth(collaborator_token),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Moodboard not found"

    # Nothing in B was modified or deleted through A's paths.
    await db_session.refresh(foreign_question)
    assert foreign_question.answer is None
    await db_session.refresh(foreign_board)
    assert foreign_board.title == "Board ajeno"
    result = await db_session.execute(
        select(MoodboardItem).where(MoodboardItem.id == foreign_piece.id)
    )
    assert result.scalar_one() is not None
    result = await db_session.execute(
        select(func.count()).select_from(MoodboardComment)
    )
    assert result.scalar_one() == 0


@pytest.mark.asyncio
async def test_assigned_collaborator_writes_in_a_201_in_b_403(
    client: TestClient,
    media_storage: LocalStorage,
    active_project: Project,
    other_project: Project,
    collaborator_token: str,
):
    """A collaborator assigned to A uploads there (201) but not in B (403)."""
    board = client.post(
        f"/api/v1/projects/{active_project.id}/moodboard/boards",
        json={"title": "Board propio"},
        headers=auth(collaborator_token),
    )
    assert board.status_code == 201

    response = client.post(
        f"/api/v1/projects/{active_project.id}/moodboard/boards/"
        f"{board.json()['id']}/items",
        files={"file": ("pin.png", b"\x89PNG-fake-bytes", "image/png")},
        data={"title": "Pin propio", "sort_order": "0"},
        headers=auth(collaborator_token),
    )
    assert response.status_code == 201

    response = client.post(
        f"/api/v1/projects/{other_project.id}/moodboard/boards",
        json={"title": "Board ajeno"},
        headers=auth(collaborator_token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"

    response = client.post(
        f"/api/v1/projects/{active_project.id}/brief/questions",
        json={"prompt": "¿Pregunta propia?", "category": "general"},
        headers=auth(collaborator_token),
    )
    assert response.status_code == 201

    response = client.post(
        f"/api/v1/projects/{other_project.id}/brief/questions",
        json={"prompt": "¿Pregunta ajena?", "category": "general"},
        headers=auth(collaborator_token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No access to this project"
