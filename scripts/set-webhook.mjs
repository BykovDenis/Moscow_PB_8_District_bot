// После `npm run deploy`: npm run webhook -- https://join-request-bot.<ваш-аккаунт>.workers.dev
process.loadEnvFile(".dev.vars");

const url = process.argv[2];
if (!url) {
  console.error("Укажите адрес воркера: npm run webhook -- https://...workers.dev");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: process.env.WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query", "chat_join_request"],
  }),
}).then((r) => r.json());
console.log(res);
