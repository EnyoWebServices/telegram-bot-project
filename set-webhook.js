
require("dotenv").config();

async function main() {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;

  const baseUrl =
    "https://mistakes-spies-wearing-notifications.trycloudflare.com";

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    throw new Error("Token ya webhook secret missing hai .env mein");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${baseUrl}/telegram-webhook`,
        secret_token: TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["chat_join_request"]
      })
    }
  );

  const result = await response.json();

  if (!result.ok) {
    throw new Error(result.description);
  }

  console.log("Webhook registered:", result.result);
}

main().catch(error => {
  console.error("Webhook setup failed:", error.message);
  process.exitCode = 1;
});
