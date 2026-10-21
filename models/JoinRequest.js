
const mongoose = require("mongoose");

const joinRequestSchema = new mongoose.Schema(
  {
    channelId: { type: String, required: true },
    userId: { type: String, required: true },
    requestDate: { type: Date },
    status: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
    },
  },
  { timestamps: true }
);

joinRequestSchema.index(
  { channelId: 1, userId: 1 },
  { unique: true }
);

module.exports = mongoose.model("JoinRequest", joinRequestSchema);
