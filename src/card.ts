import { InlineKeyboard } from "grammy";
import type { RequestRow } from "./db";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const userLink = (id: number, name: string) => `<a href="tg://user?id=${id}">${esc(name)}</a>`;

const STATUS: Record<RequestRow["step"], string> = {
  resident: "⏳ Ждём ответ: живёт ли в квартале",
  place: "⏳ Ждём ответ: дом / квартал",
  review: "🟡 Ждёт решения",
  approved: "✅ Принят",
  declined: "❌ Отклонён",
  expired: "⌛ Отклонён автоматически: не ответил на вопросы",
};

function placeLine(r: RequestRow): string {
  const place = r.place ? `<b>${esc(r.place)}</b>` : "—";
  if (r.resident === 1) return `🏠 Живёт в квартале, дом: ${place}`;
  if (r.resident === 0) return `🏘 <b>Не из квартала</b>, квартал (фаза): ${place}`;
  return "🏠 Живёт в квартале: —";
}

/**
 * Telegram выдаёт id по возрастанию, поэтому по id можно грубо оценить год регистрации.
 * Границы приблизительные — это сигнал, а не точная дата.
 */
function accountAge(userId: number): string {
  if (userId < 1_000_000_000) return "до 2020";
  if (userId < 5_000_000_000) return "≈ 2020–2022";
  if (userId < 7_000_000_000) return "≈ 2022–2024";
  return "≈ 2024 или новее ⚠️";
}

const LANGS: Record<string, string> = { ru: "русский", uk: "украинский", be: "белорусский", en: "английский" };

function languageLine(code: string | null): string {
  if (!code) return "🌐 Язык Telegram: неизвестен";
  const name = LANGS[code] ?? code;
  return `🌐 Язык Telegram: ${esc(name)}${["ru", "uk", "be", "en"].includes(code) ? "" : " ⚠️"}`;
}

/** Живой человек тратит несколько секунд, чтобы открыть чат с ботом и прочитать вопрос */
const BOT_LIKE_SEC = 3;

function speedLine(sec: number | null): string | null {
  if (sec === null) return null;
  const t = sec < 60 ? `${sec} с` : sec < 3600 ? `${Math.round(sec / 60)} мин` : `${Math.round(sec / 3600)} ч`;
  return sec < BOT_LIKE_SEC
    ? `⚡ Ответил на 1-й вопрос через ${t} — подозрительно быстро, похоже на бота`
    : `⏱ Ответил на 1-й вопрос через ${t}`;
}

export function cardText(r: RequestRow): string {
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
  const lines = [
    `🆕 <b>Заявка</b>: ${userLink(r.user_id, name)}${r.username ? ` (@${esc(r.username)})` : ""}`,
    `🆔 <code>${r.user_id}</code>`,
    "",
    placeLine(r),
    ...[speedLine(r.answer_sec)].filter((l): l is string => l !== null),
    "",
    `📷 Фото профиля: ${r.photos > 0 ? `есть (${r.photos})` : "нет"}`,
    `👤 Username: ${r.username ? "есть" : "нет"}${r.premium ? " · ⭐ Premium" : ""}`,
    `📅 Аккаунт создан: ${accountAge(r.user_id)}`,
    languageLine(r.language),
  ];
  if (r.channel) lines.push(`📢 Личный канал: ${esc(r.channel)}`);
  if (r.invite_name) lines.push(`🔗 Пришёл по ссылке: ${esc(r.invite_name)}`);
  if (r.house_chats !== null) {
    lines.push(r.house_chats ? `🏢 Состоит в чатах домов: <b>${esc(r.house_chats)}</b> ✅` : "🏢 В чатах домов не состоит");
  }
  if (r.bio) lines.push(`📝 Bio: ${esc(r.bio)}`);
  if (!r.dm_ok) lines.push("", "⚠️ Бот не смог написать человеку в личку — уточните вручную");
  lines.push("", `<b>${STATUS[r.step]}</b>${r.decided_by ? ` — ${esc(r.decided_by)}` : ""}`);
  return lines.join("\n");
}

export function cardKeyboard(r: RequestRow): InlineKeyboard | undefined {
  if (r.step === "approved" || r.step === "declined" || r.step === "expired") return undefined;
  return new InlineKeyboard().text("✅ Принять", `approve:${r.user_id}`).text("❌ Отклонить", `decline:${r.user_id}`);
}

export const residentKeyboard = new InlineKeyboard()
  .text("Да, живу в 8 квартале", "resident:yes")
  .row()
  .text("Нет, в другом квартале (фазе)", "resident:no");
