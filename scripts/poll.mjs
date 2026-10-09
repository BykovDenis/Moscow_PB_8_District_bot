// Локальные тесты без публичного адреса: забираем обновления у Telegram
// и пересылаем их в `wrangler dev` так, как это делал бы вебхук.
process.loadEnvFile(".dev.vars");

const { BOT_TOKEN, WEBHOOK_SECRET } = process.env;
const LOCAL = "http://localhost:8787/";
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

// getUpdates не работает, пока установлен вебхук
await api("deleteWebhook");
const me = await api("getMe");
console.log(`Бот @${me.result.username} слушает обновления, пересылаю в ${LOCAL}`);

let offset = 0;
for (;;) {
  const res = await api("getUpdates", {
    offset,
    timeout: 30,
    allowed_updates: ["message", "callback_query", "chat_join_request"],
  });
  if (!res.ok) {
    console.error(res);
    await new Promise((r) => setTimeout(r, 3000));
    continue;
  }
  for (const update of res.result) {
    offset = update.update_id + 1;
    const kind = Object.keys(update).find((k) => k !== "update_id");
    const r = await fetch(LOCAL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
      body: JSON.stringify(update),
    }).catch((e) => ({ status: e.message }));
    const chat = update[kind]?.chat ?? update[kind]?.message?.chat;
    const where = chat ? ` [${chat.title ?? chat.first_name} ${chat.id}]` : "";
    console.log(`${new Date().toLocaleTimeString()} ${kind}${where} -> ${r.status}`);
  }
}
