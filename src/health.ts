import { Api } from "grammy";
import type { Env } from "./bot";

export interface Health {
  ok: boolean;
  db: boolean;
  webhook: boolean;
  pending: number;
  /** Последняя ошибка доставки от Telegram, если она была недавно */
  error: string | null;
}

/** Ошибку доставки считаем актуальной, если она случилась за последние 15 минут */
const RECENT_ERROR_SEC = 15 * 60;
/** Столько необработанных событий в очереди Telegram — уже повод насторожиться */
const MAX_PENDING = 20;

export async function checkHealth(env: Env): Promise<Health> {
  const db = await env.DB.prepare("SELECT 1").first()
    .then(() => true)
    .catch(() => false);

  const info = await new Api(env.BOT_TOKEN).getWebhookInfo().catch(() => null);
  const now = Math.floor(Date.now() / 1000);
  const recentError =
    info?.last_error_date && now - info.last_error_date < RECENT_ERROR_SEC ? (info.last_error_message ?? "ошибка") : null;
  const pending = info?.pending_update_count ?? 0;
  // Разовая ошибка не страшна: Telegram повторит доставку. Проблема — если ошибка свежая и события копятся.
  const webhook = !!info?.url && !(recentError && pending > 0) && pending < MAX_PENDING;

  return { ok: db && webhook, db, webhook, pending, error: recentError };
}

/** Раз в час: если что-то не так — написать админам. */
export async function alertIfUnhealthy(env: Env) {
  const h = await checkHealth(env);
  if (h.ok) return;
  const lines = [
    "⚠️ <b>Бот заявок: проблема</b>",
    `База данных: ${h.db ? "ок" : "недоступна"}`,
    `Связь с Telegram: ${h.webhook ? "ок" : "есть сбои"}`,
    `Необработанных событий: ${h.pending}`,
  ];
  if (h.error) lines.push(`Ошибка: ${h.error}`);
  await new Api(env.BOT_TOKEN)
    .sendMessage(env.ADMIN_CHAT_ID, lines.join("\n"), { parse_mode: "HTML" })
    .catch((e) => console.error("alert failed", e));
}
