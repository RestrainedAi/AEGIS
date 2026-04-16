"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishYtJob = publishYtJob;
const pubsub_1 = require("@google-cloud/pubsub");
const pubsub = new pubsub_1.PubSub();
const TOPIC = "yt-jobs";
async function publishYtJob(payload) {
    const dataBuffer = Buffer.from(JSON.stringify(payload));
    await pubsub.topic(TOPIC).publishMessage({ data: dataBuffer });
}
