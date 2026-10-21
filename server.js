
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

  // Telegram ko turant acknowledgement
  res.sendStatus(200);

  try {
    const request = req.body.chat_join_request;
    if (!request) return;

    const channelId = String(request.chat.id);
    const userId = String(request.from.id);

    // Sirf naya record create hoga; duplicate par null milega
    let newRequest;

    try {
      newRequest = await JoinRequest.findOneAndUpdate(
        { channelId, userId },
        {
          $setOnInsert: {
            channelId,
            userId,
            requestDate: new Date(request.date * 1000),
            status: "pending",
          },
        },
        {
          upsert: true,
          new: true,
          rawResult: true,
          runValidators: true,
        }
      );
    } catch (error) {
      // Concurrent duplicate insert unique index se reject ho sakta hai
      if (error.code === 11000) {
        console.log("Duplicate join request; skipping Meta event.");
        return;
      }
      throw error;
    }

    // MongoDB driver/Mongoose result ke version ke hisaab se
    // upsertedId ya lastErrorObject.upserted check karo
    const inserted =
      Boolean(newRequest?.lastErrorObject?.upserted) ||
      Boolean(newRequest?.upsertedId);

    if (!inserted) {
      console.log("Existing join request; skipping Meta event.");
      return;
    }

    console.log("New join request saved:", userId);

    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

    if (!pixelId || !accessToken) {
      console.error("Meta CAPI env variables missing.");
      return;
    }

    const eventId = `telegram_join_${channelId}_${userId}`;

    const metaResponse = await fetch(
      `https://graph.facebook.com/v23.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [
            {
              event_name: "Subscribe",
              event_time: Math.floor(request.date),
              event_id: eventId,
              action_source: "chat",
              user_data: {
                external_id: [
                  require("crypto")
                    .createHash("sha256")
                    .update(userId)
                    .digest("hex"),
                ],
              },
            },
          ],
        }),
      }
    );

    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error("Meta CAPI failed:", metaData);
      return;
    }

    console.log("Meta CAPI accepted event:", metaData.events_received);
  } catch (error) {
    console.error("Webhook processing failed:", error.message);
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
