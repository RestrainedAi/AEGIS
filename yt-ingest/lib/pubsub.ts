import { PubSub } from "@google-cloud/pubsub";

const pubsub = new PubSub();
const TOPIC = "yt-jobs";

export async function publishYtJob(payload: any) {
  const dataBuffer = Buffer.from(JSON.stringify(payload));
  await pubsub.topic(TOPIC).publishMessage({ data: dataBuffer });
}
