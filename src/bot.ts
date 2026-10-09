import { Api, Bot, GrammyError, type InlineKeyboard } from "grammy";
import type { ChatJoinRequest } from "grammy/types";
import { cardKeyboard, cardText, residentKeyboard } from "./card";
import { Db, type RequestRow } from "./db";
import { checkHealth } from "./health";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  MAIN_CHAT_ID: string;
  ADMIN_CHAT_ID: string;
  EXPIRE_HOURS: string;
  HOUSE_CHAT_IDS: string;
}

const MAX_ANSWER = 50;

const TEXT = {
  greeting: (hours: number) =>
    "Здравствуйте! Вы подали заявку в общий чат 8 квартала (8 фаза), мкрн Переделкино Ближнее.\n\n" +
    "Чтобы админы могли её рассмотреть, ответьте, пожалуйста, на два вопроса. " +
    `Если ответа не будет ${hours} ч, заявка отклонится автоматически.\n\n` +
    "1/2. <b>Вы живёте в 8 квартале (8 фазе)?</b>",
  pressButton: "Пожалуйста, выберите ответ кнопкой в сообщении выше.",
  house: "2/2. <b>В каком доме вы живёте?</b> Напишите номер или адрес.",
  district: "2/2. <b>В каком квартале (фазе) микрорайона вы живёте?</b>",
  done: "Спасибо! Заявка передана админам. Как только её рассмотрят, вы получите доступ к чату.",
  tooLong: `Слишком длинный ответ, уложитесь, пожалуйста, в ${MAX_ANSWER} символов.`,
  waiting: "Ваша заявка уже у админов, ждите решения.",
  noRequest:
    "Это бот заявок в общий чат 8 квартала (8 фаза), мкрн Переделкино Ближнее.\n\n" +
    "Чтобы вступить, перейдите по ссылке-приглашению в чат и нажмите «Подать заявку» — я задам пару вопросов.",
  approved: "✅ Заявка одобрена, добро пожаловать в чат!",
  declined: "Заявка отклонена. Если это ошибка, свяжитесь с админами чата.",
  expired: "Заявка отклонена: не получили ответы на вопросы. Можно подать её заново.",
};

/** Обновить карточку заявки в админ-чате (или создать, если её ещё нет). */
async function syncCard(api: Api, env: Env, db: Db, userId: number) {
  const r = await db.get(userId);
  if (!r) return;
  const text = cardText(r);
  const reply_markup = cardKeyboard(r);
  if (r.admin_msg_id) {
    try {
      await api.editMessageText(env.ADMIN_CHAT_ID, r.admin_msg_id, text, { parse_mode: "HTML", reply_markup });
    } catch (e) {
      if (!(e instanceof GrammyError && e.description.includes("message is not modified"))) throw e;
    }
  } else {
    const msg = await api.sendMessage(env.ADMIN_CHAT_ID, text, {
      parse_mode: "HTML",
      reply_markup,
      link_preview_options: { is_disabled: true },
    });
    await db.update(userId, { admin_msg_id: msg.message_id });
  }
}

async function tryDm(api: Api, chatId: number, text: string, reply_markup?: InlineKeyboard) {
  try {
    await api.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup });
    return true;
  } catch {
    return false;
  }
}

/** Сведения о заявителе, которые можно получить через Bot API. Любой запрос может не сработать — тогда пусто. */
async function profileMeta(api: Api, env: Env, req: ChatJoinRequest) {
  const userId = req.from.id;
  const houseChatIds = env.HOUSE_CHAT_IDS.split(",").map((s) => s.trim()).filter(Boolean);

  const [photos, info, houseChats] = await Promise.all([
    api.getUserProfilePhotos(userId, { limit: 1 }).then((p) => p.total_count).catch(() => 0),
    api.getChat(req.user_chat_id).catch(() => null),
    Promise.all(
      houseChatIds.map(async (chatId) => {
        const m = await api.getChatMember(chatId, userId).catch(() => null);
        const inChat =
          m && (m.status === "member" || m.status === "administrator" || m.status === "creator" ||
            (m.status === "restricted" && m.is_member));
        if (!inChat) return null;
        const chat = await api.getChat(chatId).catch(() => null);
        return chat && "title" in chat ? chat.title : chatId;
      }),
    ),
  ]);

  const personal = info && "personal_chat" in info ? info.personal_chat : undefined;
  const link = req.invite_link;
  return {
    photos,
    channel: personal ? (personal.username ? `@${personal.username}` : (personal.title ?? null)) : null,
    invite_name: link ? (link.name ?? (link.is_primary ? "основная ссылка" : "ссылка без названия")) : null,
    house_chats: houseChatIds.length ? houseChats.filter(Boolean).join(", ") : null,
  };
}

export function createBot(env: Env) {
  const bot = new Bot(env.BOT_TOKEN);
  const db = new Db(env.DB);
  const expireHours = Number(env.EXPIRE_HOURS) || 48;

  // Узнать id группы при настройке: написать /chatid в группе
  bot.command("chatid", (ctx) => ctx.reply(`id этого чата: <code>${ctx.chat.id}</code>`, { parse_mode: "HTML" }));

  // Состояние бота и статистика — только для админов общего чата, только в личке
  bot.chatType("private").command(["status", "health"], async (ctx) => {
    const member = await ctx.api.getChatMember(env.MAIN_CHAT_ID, ctx.from.id).catch(() => null);
    if (member?.status !== "creator" && member?.status !== "administrator") return ctx.reply(TEXT.noRequest);

    const [h, stats] = await Promise.all([checkHealth(env), db.stats(7)]);
    const by = Object.fromEntries(stats.map((s) => [s.step, s]));
    const n = (step: string, key: "total" | "recent" = "total") => by[step]?.[key] ?? 0;
    const lines = [
      `${h.ok ? "✅ Бот работает нормально" : "⚠️ Есть проблемы"}`,
      `База данных: ${h.db ? "ок" : "недоступна"}`,
      `Связь с Telegram: ${h.webhook ? "ок" : "сбои"}${h.error ? ` (${h.error})` : ""}`,
      `Необработанных событий: ${h.pending}`,
      "",
      "<b>Сейчас</b>",
      `⏳ Отвечают на вопросы: ${n("resident") + n("place")}`,
      `🟡 Ждут вашего решения: ${n("review")}`,
      "",
      "<b>За 7 дней</b>",
      `✅ Принято: ${n("approved", "recent")}`,
      `❌ Отклонено: ${n("declined", "recent")}`,
      `⌛ Не ответили: ${n("expired", "recent")}`,
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  // 1. Новая заявка в общий чат
  bot.on("chat_join_request", async (ctx) => {
    const req = ctx.chatJoinRequest;
    if (String(req.chat.id) !== env.MAIN_CHAT_ID) return;

    const u = req.from;
    await db.create({
      user_id: u.id,
      user_chat_id: req.user_chat_id,
      first_name: u.first_name,
      last_name: u.last_name ?? null,
      username: u.username ?? null,
      bio: req.bio ?? null,
      premium: u.is_premium ? 1 : 0,
      language: u.language_code ?? null,
      ...(await profileMeta(ctx.api, env, req)),
    });

    // Писать человеку можно только в первые 5 минут после заявки, поэтому сразу
    const dmOk = await tryDm(ctx.api, req.user_chat_id, TEXT.greeting(expireHours), residentKeyboard);
    // Ответов не будет, поэтому сразу на решение админам, без автоотклонения
    if (!dmOk) await db.update(u.id, { dm_ok: 0, step: "review" });
    await syncCard(ctx.api, env, db, u.id);
  });

  // 2a. Вопрос 1: живёт ли в квартале (кнопки)
  bot.callbackQuery(/^resident:(yes|no)$/, async (ctx) => {
    const r = await db.get(ctx.from.id);
    if (!r || r.step !== "resident") return ctx.answerCallbackQuery({ text: "Ответ уже получен" });

    const yes = ctx.match[1] === "yes";
    await db.update(r.user_id, { resident: yes ? 1 : 0, step: "place" });
    // Убрать кнопки и оставить в переписке выбранный ответ
    await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n→ ${yes ? "Да" : "Нет"}`, {
      entities: ctx.callbackQuery.message?.entities,
    });
    await ctx.answerCallbackQuery();
    await ctx.reply(yes ? TEXT.house : TEXT.district, { parse_mode: "HTML" });
    await syncCard(ctx.api, env, db, r.user_id);
  });

  // 2b. Вопрос 2 и прочие сообщения в личке
  bot.chatType("private").on("message:text", async (ctx) => {
    const r = await db.get(ctx.from.id);
    if (!r || ["approved", "declined", "expired"].includes(r.step)) return ctx.reply(TEXT.noRequest);
    const answer = ctx.message.text.trim();

    if (r.step === "resident") {
      await ctx.reply(TEXT.pressButton);
    } else if (r.step === "place") {
      if (answer.length > MAX_ANSWER) return ctx.reply(TEXT.tooLong);
      await db.update(r.user_id, { place: answer, step: "review" });
      await ctx.reply(TEXT.done);
      await syncCard(ctx.api, env, db, r.user_id);
    } else if (r.step === "review") {
      await ctx.reply(TEXT.waiting);
    }
  });

  // 3. Кнопки в админ-чате
  bot.callbackQuery(/^(approve|decline):(\d+)$/, async (ctx) => {
    if (String(ctx.chat?.id) !== env.ADMIN_CHAT_ID) return ctx.answerCallbackQuery();

    // Решать может только админ общего чата, даже если в админ-чат попал кто-то лишний
    const member = await ctx.api.getChatMember(env.MAIN_CHAT_ID, ctx.from.id);
    if (member.status !== "creator" && member.status !== "administrator") {
      return ctx.answerCallbackQuery({ text: "Только админы общего чата могут принимать решения", show_alert: true });
    }

    const action = ctx.match[1] as "approve" | "decline";
    const userId = Number(ctx.match[2]);
    const r = await db.get(userId);
    if (!r || !["resident", "place", "review"].includes(r.step)) {
      return ctx.answerCallbackQuery({ text: "Заявка уже обработана" });
    }

    const actor = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    let alreadyHandled = false;
    try {
      if (action === "approve") await ctx.api.approveChatJoinRequest(env.MAIN_CHAT_ID, userId);
      else await ctx.api.declineChatJoinRequest(env.MAIN_CHAT_ID, userId);
    } catch (e) {
      // Заявку уже обработали вручную в Telegram или человек её отозвал
      if (e instanceof GrammyError && /HIDE_REQUESTER_MISSING|USER_ALREADY_PARTICIPANT/.test(e.description)) {
        alreadyHandled = true;
      } else throw e;
    }

    const step = action === "approve" ? "approved" : "declined";
    const decidedBy = alreadyHandled ? `${actor} (заявки уже нет в Telegram)` : actor;
    await db.update(userId, { step, decided_by: decidedBy });
    await db.log(userId, alreadyHandled ? `${action}:missing` : action, ctx.from.id, actor);
    await syncCard(ctx.api, env, db, userId);
    if (!alreadyHandled) await tryDm(ctx.api, r.user_chat_id, action === "approve" ? TEXT.approved : TEXT.declined);
    await ctx.answerCallbackQuery({ text: action === "approve" ? "Принят" : "Отклонён" });
  });

  bot.catch((err) => console.error("bot error", err.error));
  return bot;
}

/** Раз в час: отклонить заявки, на которые человек не ответил вовремя. */
export async function expireStale(env: Env) {
  const api = new Api(env.BOT_TOKEN);
  const db = new Db(env.DB);
  const stale: RequestRow[] = await db.stale(Number(env.EXPIRE_HOURS) || 48);
  for (const r of stale) {
    await api.declineChatJoinRequest(env.MAIN_CHAT_ID, r.user_id).catch(() => {});
    await db.update(r.user_id, { step: "expired", decided_by: "бот" });
    await db.log(r.user_id, "expire", null, "бот");
    await syncCard(api, env, db, r.user_id).catch((e) => console.error("card", e));
    await tryDm(api, r.user_chat_id, TEXT.expired);
  }
}
