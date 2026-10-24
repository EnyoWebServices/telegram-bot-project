
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const JoinRequest = require("./models/JoinRequest");
const InviteLink = require("./models/InviteLink");
const { randomUUID, createHash } = require("crypto");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const path = require("path");

const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));

const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "https://badshah-broking-official-btt2.vercel.app",
  "https://badshah-broking-official-btt2.onrender.com",
  "https://goutam-jha-official-dhnrj.vercel.app",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// --------------------
// Landing page
// --------------------

const landingPath = path.join(__dirname, "landing-page");

app.use(express.static(landingPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(landingPath, "index.html"));
});

// --------------------
// Rate limit
// --------------------

const inviteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// --------------------
// Create unique invite + save attribution data
// --------------------

app.post("/api/create-invite-by-bot", inviteLimiter, async (req, res) => {
  try {
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!channelId || !token) {
      return res.status(500).json({
        error: "Server configuration missing",
      });
    }

    const inviteId = randomUUID();

    // Only accept strings of reasonable length.
    const cleanIdentifier = (value, maxLength = 500) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > maxLength) return null;
      return trimmed;
    };

    const fbp = cleanIdentifier(req.body?.fbp);
    const fbc = cleanIdentifier(req.body?.fbc);
    const campaignId = cleanIdentifier(req.body?.campaignId, 100);

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
        signal: AbortSignal.timeout(10000),
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
      fbp,
      fbc,
      campaignId,
      status: "created",
    });

    console.log("Invite created with attribution:", {
      inviteId,
      hasFbp: Boolean(fbp),
      hasFbc: Boolean(fbc),
      hasCampaignId: Boolean(campaignId),
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
// Existing shared invite endpoint
// Note: this endpoint does not associate a visitor
// with a unique invite record.
// --------------------

app.post("/api/create-invite", (req, res) => {
  const inviteLink = process.env.TELEGRAM_INVITE_LINK;

  if (!inviteLink) {
    return res.status(500).json({
      error: "Invite link is not configured",
    });
  }

  return res.json({ inviteLink });
});

// --------------------
// Meta Conversions API
// --------------------

async function sendMetaJoinEvent(request, channelId, userId, attribution = {}) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  const testEventCode = process.env.META_TEST_EVENT_CODE?.trim();

  if (!pixelId || !accessToken) {
    throw new Error("Meta CAPI environment variables are missing");
  }

  const eventId = `telegram_join_${channelId}_${userId}`;

  const hashedUserId = createHash("sha256")
    .update(userId)
    .digest("hex");

  const userData = {
    external_id: [hashedUserId],
  };

  // Include Meta browser identifiers only when available.
  if (attribution.fbp) {
    userData.fbp = attribution.fbp;
  }

  if (attribution.fbc) {
    userData.fbc = attribution.fbc;
  }

  const payload = {
    data: [
      {
        event_name: "Join",
        event_time: Math.floor(request.date),
        event_id: eventId,
        action_source: "chat",
        user_data: userData,
      },
    ],
  };

  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  const metaResponse = await fetch(
    `https://graph.facebook.com/v23.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    }
  );

  const metaData = await metaResponse.json();

  if (!metaResponse.ok || metaData.error) {
    console.error("Meta CAPI failed:", metaData.error || metaData);
    throw new Error("Meta CAPI request was rejected");
  }

  console.log(
    testEventCode
      ? "Meta CAPI accepted TEST Join event:"
      : "Meta CAPI accepted PRODUCTION Join event:",
    metaData.events_received,
    "Event ID:",
    eventId,
    "Has fbp:",
    Boolean(attribution.fbp),
    "Has fbc:",
    Boolean(attribution.fbc)
  );

  return metaData;
}

// --------------------
// Telegram join-request webhook
// --------------------

app.post("/telegram-webhook", async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (
    !secret ||
    req.get("X-Telegram-Bot-Api-Secret-Token") !== secret
  ) {
    return res.sendStatus(403);
  }

  // Acknowledge Telegram immediately.
  res.sendStatus(200);

  try {
    const request = req.body.chat_join_request;

    if (!request) return;

    const channelId = String(request.chat.id);
    const userId = String(request.from.id);

    if (channelId !== String(process.env.TELEGRAM_CHANNEL_ID)) {
      console.log("Ignoring join request from another channel.");
      return;
    }

    // Find the exact invite used for this join request.
    const telegramInviteUrl = request.invite_link?.invite_link;

    let inviteRecord = null;

    if (telegramInviteUrl) {
      inviteRecord = await InviteLink.findOne({
        channelId,
        inviteLink: telegramInviteUrl,
      });

      if (inviteRecord) {
        inviteRecord.status = "join_requested";
        inviteRecord.joinRequestedAt = new Date(request.date * 1000);
        inviteRecord.joinedUserId = userId;
        await inviteRecord.save();
      }
    }

    // Preserve existing duplicate protection.
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
    console.log("Matching invite found:", Boolean(inviteRecord));

    try {
      await sendMetaJoinEvent(request, channelId, userId, {
        fbp: inviteRecord?.fbp,
        fbc: inviteRecord?.fbc,
      });
    } catch (error) {
      console.error("Meta Join event failed:", error.message);
    }
  } catch (error) {
    console.error("Webhook processing failed:", error.message);
  }
});

// --------------------
// Public frontend configuration
// --------------------

app.get("/api/public-config", (req, res) => {
  res.set("Cache-Control", "public, max-age=60");

  return res.json({
    metaPixelId: process.env.META_PIXEL_ID || "",
    telegramInviteLink: process.env.TELEGRAM_INVITE_LINK || "",
  });
});

// --------------------
// Health check
// --------------------

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// --------------------
// Start server
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

      setInterval(async () => {
        try {
          const response = await fetch(
            "https://telegram-bot-project-iqzg.onrender.com/",
            { signal: AbortSignal.timeout(10000) }
          );

          if (!response.ok) {
            console.error("Keep-alive request failed:", response.status);
          }

          await response.text();
        } catch (error) {
          console.error("Keep-alive request failed:", error.message);
        }
      }, 10 * 60 * 1000);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
