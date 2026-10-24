
const mongoose = require("mongoose");

const inviteLinkSchema = new mongoose.Schema(
  {
    inviteId: {
      type: String,
      required: true,
      unique: true,
    },

    channelId: {
      type: String,
      required: true,
    },

    inviteLink: {
      type: String,
      required: true,
      unique: true,
    },

    // Meta attribution identifiers
    fbp: {
      type: String,
      default: null,
    },

    fbc: {
      type: String,
      default: null,
    },

    // Optional campaign tracking
    campaignId: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: ["created", "join_requested", "used", "revoked"],
      default: "created",
    },

    joinedUserId: {
      type: String,
      default: null,
    },

    joinRequestedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InviteLink", inviteLinkSchema);
