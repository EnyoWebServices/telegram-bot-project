
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const JoinRequest = require("./models/JoinRequest");
const { randomUUID } = require("crypto");
const rateLimit = require("express-rate-limit");
const InviteLink = require("./models/InviteLink");
const cors = require("cors");



const app = express();

app.set("trust proxy", 1);


app.use(express.json());

app.use(cors({
  origin: [
    "http://localhost:5500",
    "https://gujaratitrader-officialrmksews.vercel.app"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));




const inviteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post(
  "/api/create-invite",
  inviteLimiter,
  async (req, res) => {
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
        console.error("Telegram invite creation failed");
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
  }
);


app.post("/telegram-webhook", async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (
    !secret ||
    req.get("X-Telegram-Bot-Api-Secret-Token") !== secret
  ) {
    return res.sendStatus(403);
  }

  // Telegram ko jaldi acknowledgement bhejo
  res.sendStatus(200);

  try {
    const update = req.body;

    if (update.chat_join_request) {
      const request = update.chat_join_request;

      await JoinRequest.findOneAndUpdate(
        {
          channelId: String(request.chat.id),
          userId: String(request.from.id),
        },
        {
          $setOnInsert: {
            channelId: String(request.chat.id),
            userId: String(request.from.id),
            requestDate: new Date(request.date * 1000),
            status: "pending",
          },
        },
        { upsert: true, runValidators: true }
      );

      console.log("Join request saved to MongoDB!");
      console.log("Channel ID:", request.chat.id);
      console.log("User ID:", request.from.id);
    }
  } catch (error) {
    console.error("Database save failed:", error.message);
  }
});

app.get("/", (req, res) => {
  res.send("Telegram webhook server is running.");
});

async function startServer() {
  try {
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
