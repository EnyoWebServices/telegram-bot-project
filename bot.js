
require("dotenv").config();

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  const response = await fetch(
    `https://api.telegram.org/bot${token}/createChatInviteLink`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channelId,
        name: "Website Test Link",
        creates_join_request: true
      })
    }
  );

  const result = await response.json();

  if (!result.ok) {
    console.error("Invite link error:", result.description);
    process.exitCode = 1;
    return;
  }

  console.log("Invite link created successfully!");
  console.log("Join request enabled:", result.result.creates_join_request);
  console.log("Invite link:", result.result.invite_link);
}

main().catch(console.error);
