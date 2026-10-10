"""
Аудит участников чата через ваш аккаунт Telegram (только чтение, никого не удаляет).

Запуск:
    tools/members-audit/.venv/bin/python tools/members-audit/audit.py
    tools/members-audit/.venv/bin/python tools/members-audit/audit.py --last-message   # + дата последнего сообщения (долго)

Настройки — в tools/members-audit/.env (см. .env.example).
Отчёт — tools/members-audit/reports/members-<дата>.csv (открывается в Excel / Numbers).
"""

import argparse
import asyncio
import csv
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from telethon import TelegramClient
from telethon.tl.types import (
    ChannelParticipantAdmin,
    ChannelParticipantCreator,
    UserStatusEmpty,
    UserStatusLastMonth,
    UserStatusLastWeek,
    UserStatusOffline,
    UserStatusOnline,
    UserStatusRecently,
)

HERE = Path(__file__).parent


def load_env() -> dict[str, str]:
    env = {}
    for line in (HERE / ".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def last_seen(status) -> tuple[str, str]:
    """(категория, дата) — Telegram показывает точную дату только если человек её не скрыл."""
    if isinstance(status, UserStatusOnline):
        return "в сети", ""
    if isinstance(status, UserStatusOffline):
        days = (datetime.now(timezone.utc) - status.was_online).days
        when = status.was_online.strftime("%Y-%m-%d")
        if days <= 3:
            return "недавно", when
        if days <= 7:
            return "на этой неделе", when
        if days <= 31:
            return "в этом месяце", when
        return "давно", when
    if isinstance(status, UserStatusRecently):
        return "недавно", ""
    if isinstance(status, UserStatusLastWeek):
        return "на этой неделе", ""
    if isinstance(status, UserStatusLastMonth):
        return "в этом месяце", ""
    # UserStatusEmpty / None — «был(а) давно»: не заходил больше месяца
    return "давно", ""


def verdict(row: dict) -> str:
    """Подсказка для админа, а не решение."""
    if row["deleted"]:
        return "удалённый аккаунт"
    if row["scam"] or row["fake"]:
        return "помечен Telegram как scam/fake"
    if row["bot"] and not row["admin"]:
        return "бот"
    if row["last_seen"] == "давно" and not row["admin"]:
        return "давно не заходил в Telegram"
    return ""


async def main(with_last_message: bool):
    env = load_env()
    client = TelegramClient(str(HERE / "session"), int(env["API_ID"]), env["API_HASH"])
    await client.start()  # при первом запуске спросит телефон и код из Telegram

    chat = await client.get_entity(int(env["CHAT_ID"]))
    print(f"Чат: {chat.title}")

    rows = []
    async for u in client.iter_participants(chat):
        p = getattr(u, "participant", None)
        seen, seen_date = ("—", "") if u.deleted else last_seen(u.status)
        row = {
            "user_id": u.id,
            "username": f"@{u.username}" if u.username else "",
            "name": "Deleted Account" if u.deleted else " ".join(filter(None, [u.first_name, u.last_name])),
            "deleted": bool(u.deleted),
            "bot": bool(u.bot),
            "scam": bool(u.scam),
            "fake": bool(u.fake),
            "admin": isinstance(p, (ChannelParticipantAdmin, ChannelParticipantCreator)),
            "photo": bool(u.photo),
            "premium": bool(u.premium),
            "last_seen": seen,
            "last_seen_date": seen_date,
            "joined": p.date.strftime("%Y-%m-%d") if getattr(p, "date", None) else "",
            "last_message": "",
        }
        rows.append(row)
    print(f"Участников получено: {len(rows)}")

    if with_last_message:
        # По одному запросу на человека; при лимитах Telethon сам подождёт
        for i, row in enumerate(rows, 1):
            if row["deleted"]:
                continue
            async for m in client.iter_messages(chat, from_user=row["user_id"], limit=1):
                row["last_message"] = m.date.strftime("%Y-%m-%d")
            if i % 50 == 0:
                print(f"  последние сообщения: {i}/{len(rows)}")

    for row in rows:
        row["verdict"] = verdict(row)
        if with_last_message and not row["verdict"] and not row["last_message"] and not row["admin"]:
            row["verdict"] = "ни разу не писал в чат"

    out_dir = HERE / "reports"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"members-{datetime.now():%Y-%m-%d}.csv"
    # utf-8-sig — чтобы Excel правильно показал кириллицу
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=";")
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: (r["verdict"] == "", r["verdict"], r["name"])))

    print("\nИтого:")
    for verdict_name, n in Counter(r["verdict"] for r in rows if r["verdict"]).most_common():
        print(f"  {verdict_name}: {n}")
    print(f"  без замечаний: {sum(1 for r in rows if not r['verdict'])}")
    print("\nПоследний раз в сети:")
    for seen, n in Counter(r["last_seen"] for r in rows).most_common():
        print(f"  {seen}: {n}")
    print(f"\nОтчёт: {out}")

    await client.disconnect()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--last-message", action="store_true", help="узнать дату последнего сообщения каждого (долго)")
    asyncio.run(main(ap.parse_args().last_message))
