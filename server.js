
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const JoinRequest = require("./models/JoinRequest");
const InviteLink = require("./models/InviteLink");
const { randomUUID, createHash } = require("crypto");
const rateLimit = require("express-rate-limit");
const cors = require("cors");

const app = express();

app.set("trust proxy", 1);
app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5500",
      "https://badshah-broking-official-btt2.vercel.app",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// --------------------
// Create Telegram Invite
// --------------------

const inviteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/create-invite", inviteLimiter, async (req, res) => {
  try {
    const inviteId = randomUUID();
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!channelId || !token) {
      return res.status(500).json({
        error: "Server configuration missing",
      });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${token}/createChatInviteLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channelId,
          name: `lp-${inviteId.slice(0, 20)}`,
          creates_join_request: true,
        }),
      }
    );

    const telegramData = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramData.ok) {
      console.error(
        "Telegram invite creation failed:",
        telegramData.description || telegramResponse.status
      );

      return res.status(502).json({
        error: "Could not create invite link",
      });
    }

    const inviteLink = telegramData.result.invite_link;

    await InviteLink.create({
      inviteId,
      channelId: String(channelId),
      inviteLink,
      status: "created",
    });

    return res.json({ inviteLink });
  } catch (error) {
    console.error("Invite API failed:", error.message);

    return res.status(500).json({
      error: "Could not generate invite link",
    });
  }
});

// --------------------
// Meta Conversions API
// --------------------

async function sendMetaSubscribeEvent(request, channelId, userId) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    throw new Error("Meta CAPI environment variables are missing");
  }

  const eventId = `telegram_join_${channelId}_${userId}`;

  const hashedUserId = createHash("sha256")
    .update(userId)
    .digest("hex");

  const metaResponse = await fetch(
    `https://graph.facebook.com/v23.0/${pixelId}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_token: accessToken,
        data: [
          {
            event_name: "Subscribe",
            event_time: Math.floor(request.date),
            event_id: eventId,
            action_source: "chat",
            user_data: {
              external_id: [hashedUserId],
            },
          },
        ],
      }),
    }
  );

  const metaData = await metaResponse.json();

  if (!metaResponse.ok || metaData.error) {
    console.error("Meta CAPI failed:", metaData.error || metaData);
    throw new Error("Meta CAPI request was rejected");
  }

  console.log(
    "Meta CAPI accepted event:",
    metaData.events_received,
    "Event ID:",
    eventId
  );

  return metaData;
}

// --------------------
// Telegram Join Request Webhook
// --------------------

app.post("/telegram-webhook", async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (
    !secret ||
    req.get("X-Telegram-Bot-Api-Secret-Token") !== secret
  ) {
    return res.sendStatus(403);
  }

  // Telegram ko turant acknowledgement
  res.sendStatus(200);

  try {
    const request = req.body.chat_join_request;

    if (!request) {
      return;
    }

    const channelId = String(request.chat.id);
    const userId = String(request.from.id);

    // Sirf configured Telegram channel ki requests process karo
    if (channelId !== String(process.env.TELEGRAM_CHANNEL_ID)) {
      console.log("Ignoring join request from another channel.");
      return;
    }

    // Unique index (channelId + userId) duplicate records ko rokta hai.
    // Meta event sirf successful new insert ke baad attempt hoga.
    try {
      await JoinRequest.create({
        channelId,
        userId,
        requestDate: new Date(request.date * 1000),
        status: "pending",
      });
    } catch (error) {
      if (error.code === 11000) {
        console.log(
          "Duplicate join request; skipping Meta event:",
          userId
        );
        return;
      }

      throw error;
    }

    console.log("New join request saved:", userId);

    try {
      await sendMetaSubscribeEvent(request, channelId, userId);
    } catch (error) {
      console.error("Meta Subscribe event failed:", error.message);
    }
  } catch (error) {
    console.error("Webhook processing failed:", error.message);
  }
});

// --------------------
// Health Check
// --------------------

app.get("/", (req, res) => {
  res.send("Telegram webhook server is running.");
});

// --------------------
// Start Server
// --------------------

async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected successfully!");

    const port = process.env.PORT || 3000;

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
