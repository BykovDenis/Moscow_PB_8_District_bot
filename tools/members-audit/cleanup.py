"""
Аккуратное удаление участников по отчёту audit.py.

По умолчанию ничего не удаляет — только показывает список (пробный прогон).

    # 1. посмотреть, кого удалил бы (удалённые аккаунты)
    tools/members-audit/.venv/bin/python tools/members-audit/cleanup.py

    # 2. удалить их по-настоящему
    tools/members-audit/.venv/bin/python tools/members-audit/cleanup.py --apply

    # другая категория из отчёта (живые люди — только осознанно!)
    tools/members-audit/.venv/bin/python tools/members-audit/cleanup.py --category "бот"

Защиты:
- участники берутся заново из Telegram, а не из старого отчёта, и каждый перепроверяется;
- админов и владельца не трогает никогда;
- удаление без бана: человек сможет вернуться через заявку;
- не больше --limit человек за запуск, пауза --pause секунд между удалениями;
- каждое удаление записывается в reports/removed-<дата>.csv.
"""

import argparse
import asyncio
import csv
from datetime import datetime
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.types import ChannelParticipantAdmin, ChannelParticipantCreator

from audit import HERE, last_seen, load_env

# Категория отчёта → как перепроверить её по свежим данным
RECHECK = {
    "удалённый аккаунт": lambda u: bool(u.deleted),
    "помечен Telegram как scam/fake": lambda u: bool(u.scam or u.fake),
    "бот": lambda u: bool(u.bot),
    "давно не заходил в Telegram": lambda u: not u.deleted and last_seen(u.status)[0] == "давно",
}
SAFE = "удалённый аккаунт"


def latest_report() -> Path:
    reports = sorted((HERE / "reports").glob("members-*.csv"))
    if not reports:
        raise SystemExit("Нет отчёта. Сначала запустите audit.py")
    return reports[-1]


async def main(category: str, apply: bool, limit: int, pause: float):
    if category not in RECHECK:
        raise SystemExit(f"Неизвестная категория. Доступны: {', '.join(RECHECK)}")

    report = latest_report()
    with report.open(encoding="utf-8-sig") as f:
        ids = {int(r["user_id"]) for r in csv.DictReader(f, delimiter=";") if r["verdict"] == category}
    print(f"Отчёт: {report.name}, в категории «{category}»: {len(ids)}")

    env = load_env()
    client = TelegramClient(str(HERE / "session"), int(env["API_ID"]), env["API_HASH"])
    await client.start()
    chat = await client.get_entity(int(env["CHAT_ID"]))

    # Свежий список: кто уже вышел — пропускаем; кто перестал подходить под категорию — тоже
    targets = []
    async for u in client.iter_participants(chat):
        if u.id not in ids:
            continue
        p = getattr(u, "participant", None)
        if isinstance(p, (ChannelParticipantAdmin, ChannelParticipantCreator)) or u.is_self:
            continue
        if RECHECK[category](u):
            targets.append(u)
    skipped = len(ids) - len(targets)
    targets = targets[:limit]

    print(f"Подтверждено сейчас: {len(targets)}" + (f" (ещё {skipped} уже вышли или не подходят)" if skipped else ""))
    for u in targets:
        name = "Deleted Account" if u.deleted else " ".join(filter(None, [u.first_name, u.last_name]))
        print(f"  {u.id:>12}  {('@' + u.username) if u.username else '':<20} {name}")

    if not targets:
        return await client.disconnect()
    if not apply:
        print("\nЭто пробный прогон — никто не удалён. Чтобы удалить: добавьте --apply")
        return await client.disconnect()

    # Подтверждение: для живых людей — вводом числа, чтобы не нажать Enter по привычке
    if category == SAFE:
        ok = input(f"\nУдалить {len(targets)} удалённых аккаунтов? [y/N] ").strip().lower() == "y"
    else:
        print(f"\n⚠️  Это могут быть ЖИВЫЕ люди. Они смогут вернуться через заявку, но заметят удаление.")
        ok = input(f"Для подтверждения введите число удаляемых ({len(targets)}): ").strip() == str(len(targets))
    if not ok:
        print("Отменено.")
        return await client.disconnect()

    log_path = HERE / "reports" / f"removed-{datetime.now():%Y-%m-%d}.csv"
    new_log = not log_path.exists()
    with log_path.open("a", newline="", encoding="utf-8-sig") as log:
        w = csv.writer(log, delimiter=";")
        if new_log:
            w.writerow(["time", "user_id", "username", "name", "category"])
        for i, u in enumerate(targets, 1):
            try:
                # kick = исключить без бана (Telethon сам снимает бан сразу после исключения)
                await client.kick_participant(chat, u)
            except FloodWaitError as e:
                print(f"Telegram просит подождать {e.seconds} с — останавливаюсь. Запустите позже, продолжит с оставшихся.")
                break
            name = "Deleted Account" if u.deleted else " ".join(filter(None, [u.first_name, u.last_name]))
            w.writerow([datetime.now().isoformat(timespec="seconds"), u.id, u.username or "", name, category])
            log.flush()
            print(f"  [{i}/{len(targets)}] удалён {u.id} {name}")
            await asyncio.sleep(pause)

    print(f"\nЖурнал: {log_path}")
    await client.disconnect()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", default=SAFE, help=f"категория из отчёта (по умолчанию «{SAFE}»)")
    ap.add_argument("--apply", action="store_true", help="удалить по-настоящему (без флага — только показать)")
    ap.add_argument("--limit", type=int, default=50, help="максимум за один запуск (по умолчанию 50)")
    ap.add_argument("--pause", type=float, default=5, help="пауза между удалениями, секунд (по умолчанию 5)")
    a = ap.parse_args()
    asyncio.run(main(a.category, a.apply, a.limit, a.pause))
