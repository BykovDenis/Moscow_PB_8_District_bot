import { webhookCallback, type Bot } from "grammy";
import { createBot, expireStale, type Env } from "./bot";
import { alertIfUnhealthy, checkHealth } from "./health";

// Бот живёт, пока жив воркер, чтобы не вызывать getMe на каждый запрос
let bot: Bot | undefined;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") {
      // Для мониторинга (UptimeRobot и т.п.): 200 — всё хорошо, 503 — проблема
      if (new URL(req.url).pathname === "/health") {
        const h = await checkHealth(env);
        return Response.json(
          { ok: h.ok, db: h.db, webhook: h.webhook, pending: h.pending },
          { status: h.ok ? 200 : 503 },
        );
      }
      return new Response("ok");
    }
    // Telegram присылает секрет в заголовке, чужие запросы отбрасываются сразу
    if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    bot ??= createBot(env);
    return webhookCallback(bot, "cloudflare-mod", { secretToken: env.WEBHOOK_SECRET })(req);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([expireStale(env), alertIfUnhealthy(env)]));
  },
} satisfies ExportedHandler<Env>;
