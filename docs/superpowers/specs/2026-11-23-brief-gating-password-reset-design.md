# Brief Question Management + Ready Gate & Admin-Mediated Password Reset — Design

Status: approved by the user on 2026-11-23 (plan-first gate per AGENTS.md).

## Intent

1. Studio team can edit/delete brief questions; clients only see and answer a
   brief after the team explicitly confirms and sends it as ready.
2. Users can request a password reset from the login screen; SUPER_ADMIN
   approves and assigns a temporary password; the user must change it before
   normal access.

## Decisions (approved)

- `projects.brief_sent_at` (nullable timestamp) is the ready gate. NULL = draft.
  Migration backfills projects that already have answered questions so existing
  clients keep access.
- Question edit/delete uses the same guard as creation (`require_team_member`:
  SUPER_ADMIN always; LEAD_DESIGNER/COLLABORATOR via membership) + ACTIVE project.
- Deleting an answered question requires `?force=true` (409 otherwise); deletion
  cascades child images and removes stored media files. Audit records `had_response`.
- Pre-send CLIENT reads: question items hidden (references stay), counts zeroed,
  `brief_sent: false` flag; question media reads 404. Answer/autosave/upload/
  delete-media/confirm routes return 409 before any mutation.
- `POST /brief/send` is one-way (no un-send), 409 if already sent, notifies the
  client (`brief.ready`) via a new `notify_project_client` helper, audited.
- Password reset: public request endpoint always returns the same generic 200
  (no enumeration); pending requests deduplicated per user. Admin approves with
  optional custom temporary password (else `secrets.token_urlsafe(12)`), hashed
  with `core/security.get_password_hash`; plaintext returned once, never audited.
- `users.must_change_password` flag. Backend hard block: `get_current_active_user`
  raises 403 `password_change_required` for flagged users; `/auth/me` and
  `/auth/change-password` use a flag-tolerant variant. Login `Token` and `UserRead`
  expose the flag; frontend redirects to `/change-password`.
- Question reordering is out of scope (no position column exists; order = created_at).

## Non-goals

No email delivery (admin mediates out-of-band), no un-send, no construction/
on-site modules (AGENTS.md domain exclusions), no rate limiting infrastructure.
