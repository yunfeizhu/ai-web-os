from __future__ import annotations

import email
import imaplib
import json
import os
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.mail import MailAccount, MailMessage

router = APIRouter()
MAIL_CONFIG_VERSION = 1
USER_CONFIG_DIR = Path(
    os.getenv("AI_NATIVE_OS_HOME", str(Path.home() / ".ai-web-os"))
).expanduser()
MAIL_CONFIG_PATH = USER_CONFIG_DIR / "mail.json"


FOLDER_PRESETS: dict[str, dict[str, str | list[str]]] = {
    "inbox": {
        "label": "收件箱",
        "candidates": ["INBOX"],
    },
    "sent": {
        "label": "已发送",
        "candidates": [
            "Sent",
            "Sent Messages",
            "Sent Items",
            "INBOX.Sent",
            "INBOX.Sent Messages",
            "[Gmail]/Sent Mail",
            "已发送",
        ],
    },
    "drafts": {
        "label": "草稿箱",
        "candidates": [
            "Drafts",
            "INBOX.Drafts",
            "[Gmail]/Drafts",
            "草稿箱",
        ],
    },
}


class MailAccountPayload(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    imap_host: str
    imap_port: int = 993
    imap_username: str
    imap_password: str
    imap_ssl: bool = True
    smtp_host: str
    smtp_port: int = 465
    smtp_username: str
    smtp_password: str
    smtp_ssl: bool = True


class MailSendPayload(BaseModel):
    to: list[str]
    cc: list[str] = Field(default_factory=list)
    bcc: list[str] = Field(default_factory=list)
    subject: str = ""
    body: str = ""
    draft_id: str | None = None


class MailDraftPayload(BaseModel):
    id: str | None = None
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    bcc: list[str] = Field(default_factory=list)
    subject: str = ""
    body: str = ""


class LocalMailAccountPayload(MailAccountPayload):
    id: str = Field(min_length=1, max_length=255)


class LocalMailDraftRequest(BaseModel):
    account: LocalMailAccountPayload
    draft: MailDraftPayload


class LocalMailSendRequest(BaseModel):
    account: LocalMailAccountPayload
    message: MailSendPayload


class LocalMailAttachmentRequest(BaseModel):
    account: LocalMailAccountPayload
    message_id: str
    attachment_id: str


class LocalMailMessageRequest(BaseModel):
    account: LocalMailAccountPayload
    message_id: str


@dataclass
class RuntimeMailAccount:
    id: str
    label: str
    email: str
    imap_host: str
    imap_port: int
    imap_username: str
    imap_password: str
    imap_ssl: bool
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_ssl: bool


def _decode_mime_header(raw: str | None) -> str:
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def _message_text_parts(msg: email.message.Message) -> tuple[str, str | None]:
    body_text: list[str] = []
    body_html: list[str] = []

    if msg.is_multipart():
        for part in msg.walk():
            disposition = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disposition:
                continue
            content_type = part.get_content_type()
            payload = part.get_payload(decode=True) or b""
            charset = part.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except Exception:
                decoded = payload.decode("utf-8", errors="replace")
            if content_type == "text/plain":
                body_text.append(decoded)
            elif content_type == "text/html":
                body_html.append(decoded)
    else:
        payload = msg.get_payload(decode=True) or b""
        charset = msg.get_content_charset() or "utf-8"
        try:
            decoded = payload.decode(charset, errors="replace")
        except Exception:
            decoded = payload.decode("utf-8", errors="replace")
        if msg.get_content_type() == "text/html":
            body_html.append(decoded)
        else:
            body_text.append(decoded)

    text = "\n".join(part.strip() for part in body_text if part.strip())
    html = "\n".join(part.strip() for part in body_html if part.strip()) or None
    return text, html


def _extract_attachments(msg: email.message.Message) -> list[dict]:
    attachments: list[dict] = []

    for index, part in enumerate(msg.walk()):
        if part.is_multipart():
            continue

        disposition = (part.get("Content-Disposition") or "").lower()
        filename = _decode_mime_header(part.get_filename())
        content_id = (part.get("Content-ID") or "").strip("<> ")
        if "attachment" not in disposition and "inline" not in disposition and not filename:
            continue

        payload = part.get_payload(decode=True) or b""
        attachments.append(
            {
                "id": str(index),
                "filename": filename or f"附件-{len(attachments) + 1}",
                "content_type": part.get_content_type() or "application/octet-stream",
                "size": len(payload),
                "inline": "inline" in disposition,
                "content_id": content_id or None,
            }
        )

    return attachments


def _serialize_account(account: MailAccount) -> dict:
    return {
        "id": account.id,
        "label": account.label,
        "email": account.email,
        "imap_host": account.imap_host,
        "imap_port": account.imap_port,
        "imap_username": account.imap_username,
        "imap_ssl": account.imap_ssl,
        "smtp_host": account.smtp_host,
        "smtp_port": account.smtp_port,
        "smtp_username": account.smtp_username,
        "smtp_ssl": account.smtp_ssl,
        "created_at": account.created_at.isoformat(),
        "updated_at": account.updated_at.isoformat(),
    }


def _serialize_local_account(account: RuntimeMailAccount | LocalMailAccountPayload) -> dict:
    return {
        "id": account.id,
        "label": account.label,
        "email": account.email,
        "imap_host": account.imap_host,
        "imap_port": account.imap_port,
        "imap_username": account.imap_username,
        "imap_password": account.imap_password,
        "imap_ssl": account.imap_ssl,
        "smtp_host": account.smtp_host,
        "smtp_port": account.smtp_port,
        "smtp_username": account.smtp_username,
        "smtp_password": account.smtp_password,
        "smtp_ssl": account.smtp_ssl,
    }


def _runtime_account_from_payload(payload: LocalMailAccountPayload) -> RuntimeMailAccount:
    return RuntimeMailAccount(
        id=payload.id,
        label=payload.label,
        email=payload.email,
        imap_host=payload.imap_host,
        imap_port=payload.imap_port,
        imap_username=payload.imap_username,
        imap_password=payload.imap_password,
        imap_ssl=payload.imap_ssl,
        smtp_host=payload.smtp_host,
        smtp_port=payload.smtp_port,
        smtp_username=payload.smtp_username,
        smtp_password=payload.smtp_password,
        smtp_ssl=payload.smtp_ssl,
    )


def _runtime_account_from_dict(data: dict) -> RuntimeMailAccount:
    payload = LocalMailAccountPayload.model_validate(data)
    return _runtime_account_from_payload(payload)


def _load_local_accounts() -> list[RuntimeMailAccount]:
    if not MAIL_CONFIG_PATH.exists():
        return []

    try:
        payload = json.loads(MAIL_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []

    raw_accounts = payload.get("accounts", []) if isinstance(payload, dict) else []
    accounts: list[RuntimeMailAccount] = []
    for item in raw_accounts:
        if not isinstance(item, dict):
            continue
        try:
            accounts.append(_runtime_account_from_dict(item))
        except Exception:
            continue
    return accounts


def _write_local_accounts(accounts: list[RuntimeMailAccount]) -> None:
    USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": MAIL_CONFIG_VERSION,
        "accounts": [_serialize_local_account(account) for account in accounts],
    }
    MAIL_CONFIG_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _get_local_account(account_id: str) -> RuntimeMailAccount:
    for account in _load_local_accounts():
        if account.id == account_id:
            return account
    raise HTTPException(status_code=404, detail="Account not found")


def _serialize_message(message: MailMessage) -> dict:
    metadata = message.metadata_json or {}
    return {
        "id": message.id,
        "account_id": message.account_id,
        "folder": message.folder,
        "uid": message.uid,
        "message_id": message.message_id,
        "subject": message.subject,
        "sender": message.sender,
        "recipients": message.recipients,
        "sent_at": message.sent_at.isoformat() if message.sent_at else None,
        "snippet": message.snippet,
        "body_text": message.body_text,
        "body_html": message.body_html,
        "seen": message.seen,
        "metadata": metadata,
        "attachments": metadata.get("attachments", []),
        "synced_at": message.synced_at.isoformat(),
    }


def _imap_connect(account: MailAccount | RuntimeMailAccount):
    if account.imap_ssl:
        client = imaplib.IMAP4_SSL(account.imap_host, account.imap_port)
    else:
        client = imaplib.IMAP4(account.imap_host, account.imap_port)
        client.starttls(ssl.create_default_context())
    client.login(account.imap_username, account.imap_password)
    return client


def _smtp_send(account: MailAccount | RuntimeMailAccount, payload: MailSendPayload) -> None:
    message = EmailMessage()
    message["From"] = account.email
    message["To"] = ", ".join(payload.to)
    if payload.cc:
        message["Cc"] = ", ".join(payload.cc)
    message["Subject"] = payload.subject
    message.set_content(payload.body or "")

    recipients = payload.to + payload.cc + payload.bcc
    if account.smtp_ssl:
        with smtplib.SMTP_SSL(account.smtp_host, account.smtp_port) as smtp:
            smtp.login(account.smtp_username, account.smtp_password)
            smtp.send_message(message, to_addrs=recipients)
        return

    with smtplib.SMTP(account.smtp_host, account.smtp_port) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(account.smtp_username, account.smtp_password)
        smtp.send_message(message, to_addrs=recipients)


def _normalize_folder(folder: str | None) -> str:
    raw = (folder or "").strip().lower()
    if raw in {"inbox", "收件箱"}:
        return "inbox"
    if raw in {"sent", "sent items", "sent messages", "已发送"}:
        return "sent"
    if raw in {"drafts", "draft", "草稿箱"}:
        return "drafts"
    return "inbox"


def _resolve_remote_folder(client, folder: str) -> tuple[str, str | None]:
    canonical = _normalize_folder(folder)
    candidates = list(FOLDER_PRESETS[canonical]["candidates"])
    if canonical == "inbox":
        status, _ = client.select('"INBOX"', readonly=True)
        if status == "OK":
            return canonical, "INBOX"
        return canonical, None

    for candidate in candidates:
        status, _ = client.select(f'"{candidate}"', readonly=True)
        if status == "OK":
            return canonical, candidate
    return canonical, None


def _snippet_from_text(value: str) -> str:
    return value.replace("\r", " ").replace("\n", " ").strip()[:220]


async def _get_account(db: AsyncSession, account_id: str) -> MailAccount:
    account = await db.get(MailAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


async def _get_message_for_account(
    db: AsyncSession,
    account_id: str,
    message_id: str,
) -> MailMessage:
    message = await db.get(MailMessage, message_id)
    if message is None or message.account_id != account_id:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


async def _list_messages_for_folder(
    db: AsyncSession,
    account_id: str,
    folder: str,
) -> list[dict]:
    result = await db.execute(
        select(MailMessage)
        .where(
            MailMessage.account_id == account_id,
            MailMessage.folder == _normalize_folder(folder),
        )
        .order_by(MailMessage.sent_at.desc().nullslast(), MailMessage.synced_at.desc())
    )
    return [_serialize_message(item) for item in result.scalars().all()]


async def _sync_messages_for_account(
    db: AsyncSession,
    account_id: str,
    account: MailAccount | RuntimeMailAccount,
    folder: str,
    limit: int,
) -> list[dict]:
    client = None
    try:
        client = _imap_connect(account)
        canonical_folder, remote_folder = _resolve_remote_folder(client, folder)
        if remote_folder is None:
            if canonical_folder == "inbox":
                raise HTTPException(status_code=400, detail="Inbox folder is not available")
            return await _list_messages_for_folder(db, account_id, canonical_folder)

        status, data = client.uid("search", None, "ALL")
        if status != "OK":
            raise RuntimeError("Unable to search messages")

        ids = [item for item in (data[0] or b"").split() if item][-limit:]
        ids.reverse()

        for raw_uid in ids:
            uid = raw_uid.decode("utf-8", errors="ignore")
            status, msg_data = client.uid("fetch", raw_uid, "(RFC822 FLAGS)")
            if status != "OK" or not msg_data:
                continue

            raw_message, flag_blob = _extract_fetch_payload(msg_data)
            if not raw_message:
                continue

            parsed = email.message_from_bytes(raw_message)
            body_text, body_html = _message_text_parts(parsed)
            attachments = _extract_attachments(parsed)
            message_id = (parsed.get("Message-Id") or "").strip() or None
            sent_at = None
            if parsed.get("Date"):
                try:
                    sent_at = parsedate_to_datetime(parsed.get("Date"))
                    if sent_at and sent_at.tzinfo is None:
                        sent_at = sent_at.replace(tzinfo=timezone.utc)
                except Exception:
                    sent_at = None

            db_id = f"{account_id}:{canonical_folder}:{uid}"
            message = await db.get(MailMessage, db_id)
            if message is None:
                message = MailMessage(
                    id=db_id,
                    account_id=account_id,
                    folder=canonical_folder,
                    uid=uid,
                )
                db.add(message)

            message.message_id = message_id
            message.subject = _decode_mime_header(parsed.get("Subject"))
            message.sender = _decode_mime_header(parsed.get("From"))
            message.recipients = _decode_mime_header(parsed.get("To"))
            message.sent_at = sent_at
            message.body_text = body_text
            message.body_html = body_html
            message.snippet = _snippet_from_text(body_text or body_html or "")
            message.seen = "\\Seen" in flag_blob
            message.metadata_json = {
                "cc": _decode_mime_header(parsed.get("Cc")),
                "reply_to": _decode_mime_header(parsed.get("Reply-To")),
                "remote_folder": remote_folder,
                "local_only": False,
                "attachments": attachments,
            }
            message.synced_at = datetime.now(timezone.utc)

        await db.flush()
        return await _list_messages_for_folder(db, account_id, canonical_folder)
    finally:
        if client is not None:
            try:
                client.logout()
            except Exception:
                pass


async def _save_draft_for_account(
    db: AsyncSession,
    account_id: str,
    sender_email: str,
    payload: MailDraftPayload,
) -> dict:
    now = datetime.now(timezone.utc)

    draft = None
    if payload.id:
        draft = await db.get(MailMessage, payload.id)
        if draft is None or draft.account_id != account_id or draft.folder != "drafts":
            raise HTTPException(status_code=404, detail="Draft not found")

    if draft is None:
        draft = MailMessage(
            id=payload.id or f"{account_id}:drafts:local:{uuid.uuid4()}",
            account_id=account_id,
            folder="drafts",
            uid=f"local-draft-{uuid.uuid4()}",
        )
        db.add(draft)

    draft.message_id = None
    draft.subject = payload.subject
    draft.sender = sender_email
    draft.recipients = ", ".join(payload.to)
    draft.sent_at = now
    draft.body_text = payload.body
    draft.body_html = None
    draft.snippet = _snippet_from_text(payload.body)
    draft.seen = True
    draft.metadata_json = {
        "cc": ", ".join(payload.cc),
        "bcc": ", ".join(payload.bcc),
        "local_only": True,
        "draft": True,
        "attachments": [],
    }
    draft.synced_at = now
    await db.flush()
    return _serialize_message(draft)


async def _send_mail_for_account(
    db: AsyncSession,
    account_id: str,
    account: MailAccount | RuntimeMailAccount,
    payload: MailSendPayload,
) -> dict:
    if not payload.to:
        raise HTTPException(status_code=400, detail="At least one recipient is required")

    try:
        _smtp_send(account, payload)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"SMTP send failed: {exc}") from exc

    now = datetime.now(timezone.utc)
    sent_record = MailMessage(
        id=f"{account_id}:sent:local:{uuid.uuid4()}",
        account_id=account_id,
        folder="sent",
        uid=f"local-sent-{uuid.uuid4()}",
        subject=payload.subject,
        sender=account.email,
        recipients=", ".join(payload.to),
        sent_at=now,
        snippet=_snippet_from_text(payload.body),
        body_text=payload.body,
        body_html=None,
        seen=True,
        metadata_json={
            "cc": ", ".join(payload.cc),
            "bcc": ", ".join(payload.bcc),
            "local_only": True,
            "attachments": [],
        },
        synced_at=now,
    )
    db.add(sent_record)

    if payload.draft_id:
        draft = await db.get(MailMessage, payload.draft_id)
        if draft is not None and draft.account_id == account_id and draft.folder == "drafts":
            await db.delete(draft)

    await db.flush()
    return {"status": "sent", "message": _serialize_message(sent_record)}


async def _download_attachment_for_account(
    db: AsyncSession,
    account_id: str,
    account: MailAccount | RuntimeMailAccount,
    message_id: str,
    attachment_id: str,
) -> Response:
    message = await _get_message_for_account(db, account_id, message_id)

    metadata = message.metadata_json or {}
    if metadata.get("local_only"):
        raise HTTPException(status_code=404, detail="Attachment is not available for local message")

    remote_folder = metadata.get("remote_folder")
    if not isinstance(remote_folder, str) or not remote_folder:
        raise HTTPException(status_code=404, detail="Remote folder is unavailable")

    client = None
    try:
        client = _imap_connect(account)
        status, _ = client.select(f'"{remote_folder}"', readonly=True)
        if status != "OK":
            raise HTTPException(status_code=404, detail="Unable to open remote folder")

        status, msg_data = client.uid("fetch", message.uid, "(RFC822)")
        if status != "OK" or not msg_data:
            raise HTTPException(status_code=404, detail="Message source is unavailable")

        raw_message, _ = _extract_fetch_payload(msg_data)
        if not raw_message:
            raise HTTPException(status_code=404, detail="Attachment source is unavailable")

        parsed = email.message_from_bytes(raw_message)
        for index, part in enumerate(parsed.walk()):
            if str(index) != attachment_id:
                continue
            if part.is_multipart():
                continue

            disposition = (part.get("Content-Disposition") or "").lower()
            filename = _decode_mime_header(part.get_filename())
            if "attachment" not in disposition and "inline" not in disposition and not filename:
                continue

            payload = part.get_payload(decode=True) or b""
            safe_name = filename or f"附件-{attachment_id}"
            return Response(
                content=payload,
                media_type=part.get_content_type() or "application/octet-stream",
                headers={"Content-Disposition": _content_disposition(safe_name)},
            )

        raise HTTPException(status_code=404, detail="Attachment not found")
    finally:
        if client is not None:
            try:
                client.logout()
            except Exception:
                pass


async def _mark_message_seen_for_account(
    db: AsyncSession,
    account_id: str,
    account: MailAccount | RuntimeMailAccount,
    message_id: str,
) -> dict:
    message = await _get_message_for_account(db, account_id, message_id)

    metadata = message.metadata_json or {}
    remote_folder = metadata.get("remote_folder")
    local_only = bool(metadata.get("local_only"))

    if not message.seen and not local_only and isinstance(remote_folder, str) and remote_folder:
        client = None
        try:
            client = _imap_connect(account)
            status, _ = client.select(f'"{remote_folder}"')
            if status == "OK":
                client.uid("store", message.uid, "+FLAGS", "(\\Seen)")
        finally:
            if client is not None:
                try:
                    client.logout()
                except Exception:
                    pass

    if not message.seen:
        message.seen = True
        message.synced_at = datetime.now(timezone.utc)
        await db.flush()

    return _serialize_message(message)


def _extract_fetch_payload(msg_data) -> tuple[bytes | None, str]:
    raw_message = None
    flag_blob = ""
    for chunk in msg_data:
        if isinstance(chunk, tuple) and len(chunk) == 2:
            raw_message = chunk[1]
            flag_blob = chunk[0].decode("utf-8", errors="ignore")
            break
    return raw_message, flag_blob


def _content_disposition(filename: str) -> str:
    encoded = quote(filename)
    return f"attachment; filename*=UTF-8''{encoded}"


@router.get("/accounts")
async def list_accounts():
    return [_serialize_local_account(item) for item in _load_local_accounts()]


@router.post("/accounts")
async def create_account(payload: MailAccountPayload):
    accounts = _load_local_accounts()
    account = RuntimeMailAccount(id=str(uuid.uuid4()), **payload.model_dump())
    accounts.insert(0, account)
    _write_local_accounts(accounts)
    return _serialize_local_account(account)


@router.put("/accounts/{account_id}")
async def update_account(
    account_id: str,
    payload: MailAccountPayload,
):
    accounts = _load_local_accounts()
    next_accounts: list[RuntimeMailAccount] = []
    updated: RuntimeMailAccount | None = None
    for account in accounts:
        if account.id != account_id:
            next_accounts.append(account)
            continue
        values = payload.model_dump()
        updated = RuntimeMailAccount(
            id=account_id,
            label=values["label"],
            email=values["email"],
            imap_host=values["imap_host"],
            imap_port=values["imap_port"],
            imap_username=values["imap_username"],
            imap_password=values["imap_password"] or account.imap_password,
            imap_ssl=values["imap_ssl"],
            smtp_host=values["smtp_host"],
            smtp_port=values["smtp_port"],
            smtp_username=values["smtp_username"],
            smtp_password=values["smtp_password"] or account.smtp_password,
            smtp_ssl=values["smtp_ssl"],
        )
        next_accounts.append(updated)

    if updated is None:
        raise HTTPException(status_code=404, detail="Account not found")

    _write_local_accounts(next_accounts)
    return _serialize_local_account(updated)


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    accounts = _load_local_accounts()
    next_accounts = [account for account in accounts if account.id != account_id]
    if len(next_accounts) == len(accounts):
        raise HTTPException(status_code=404, detail="Account not found")

    _write_local_accounts(next_accounts)
    await db.execute(delete(MailMessage).where(MailMessage.account_id == account_id))
    return {"status": "deleted"}


@router.post("/accounts/{account_id}/test")
async def test_account(account_id: str):
    account = _get_local_account(account_id)
    try:
        client = _imap_connect(account)
        client.logout()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"IMAP connection failed: {exc}") from exc
    return {"status": "ok"}


@router.post("/accounts/{account_id}/sync")
async def sync_messages(
    account_id: str,
    folder: str = Query(default="inbox"),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account(db, account_id)
    try:
        return await _sync_messages_for_account(db, account_id, account, folder, limit)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Sync failed: {exc}") from exc


@router.post("/local/sync")
async def sync_messages_local(
    payload: LocalMailAccountPayload,
    folder: str = Query(default="inbox"),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await _sync_messages_for_account(
            db,
            payload.id,
            _runtime_account_from_payload(payload),
            folder,
            limit,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Sync failed: {exc}") from exc


@router.get("/accounts/{account_id}/messages")
async def list_messages(
    account_id: str,
    folder: str = Query(default="inbox"),
    db: AsyncSession = Depends(get_db),
):
    return await _list_messages_for_folder(db, account_id, folder)


@router.get("/accounts/{account_id}/messages/{message_id}")
async def get_message(account_id: str, message_id: str, db: AsyncSession = Depends(get_db)):
    message = await _get_message_for_account(db, account_id, message_id)
    return _serialize_message(message)


@router.post("/accounts/{account_id}/messages/{message_id}/seen")
async def mark_message_seen(
    account_id: str,
    message_id: str,
    db: AsyncSession = Depends(get_db),
):
    account = _get_local_account(account_id)
    return await _mark_message_seen_for_account(db, account_id, account, message_id)


@router.get("/accounts/{account_id}/messages/{message_id}/attachments/{attachment_id}")
async def download_attachment(
    account_id: str,
    message_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account(db, account_id)
    return await _download_attachment_for_account(db, account_id, account, message_id, attachment_id)


@router.post("/local/attachments/download")
async def download_attachment_local(
    payload: LocalMailAttachmentRequest,
    db: AsyncSession = Depends(get_db),
):
    return await _download_attachment_for_account(
        db,
        payload.account.id,
        _runtime_account_from_payload(payload.account),
        payload.message_id,
        payload.attachment_id,
    )


@router.post("/local/messages/seen")
async def mark_message_seen_local(
    payload: LocalMailMessageRequest,
    db: AsyncSession = Depends(get_db),
):
    return await _mark_message_seen_for_account(
        db,
        payload.account.id,
        _runtime_account_from_payload(payload.account),
        payload.message_id,
    )


@router.post("/accounts/{account_id}/drafts")
async def save_draft(
    account_id: str,
    payload: MailDraftPayload,
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account(db, account_id)
    return await _save_draft_for_account(db, account_id, account.email, payload)


@router.post("/local/drafts")
async def save_draft_local(
    request: LocalMailDraftRequest,
    db: AsyncSession = Depends(get_db),
):
    return await _save_draft_for_account(
        db,
        request.account.id,
        request.account.email,
        request.draft,
    )


@router.post("/accounts/{account_id}/send")
async def send_message(
    account_id: str,
    payload: MailSendPayload,
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account(db, account_id)
    return await _send_mail_for_account(db, account_id, account, payload)


@router.post("/local/send")
async def send_message_local(
    request: LocalMailSendRequest,
    db: AsyncSession = Depends(get_db),
):
    return await _send_mail_for_account(
        db,
        request.account.id,
        _runtime_account_from_payload(request.account),
        request.message,
    )
