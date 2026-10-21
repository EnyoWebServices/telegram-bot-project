
const mongoose = require("mongoose");

const inviteLinkSchema = new mongoose.Schema(
  {
    inviteId: { type: String, required: true, unique: true },
    channelId: { type: String, required: true },
    inviteLink: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["created", "join_requested", "used", "revoked"],
      default: "created",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InviteLink", inviteLinkSchema);
