"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writePlaylistItemsToRun = writePlaylistItemsToRun;
const firestore_1 = require("./firestore");
async function writePlaylistItemsToRun(runId, playlistId, items) {
    const batch = firestore_1.db.batch();
    for (const item of items) {
        const videoId = item?.contentDetails?.videoId;
        if (!videoId)
            continue;
        const docRef = firestore_1.db.collection("yt_runs").doc(runId).collection("items").doc(videoId);
        batch.set(docRef, {
            runId,
            playlistId,
            videoId,
            title: item?.snippet?.title ?? null,
            channelId: item?.snippet?.videoOwnerChannelId ?? null,
            channelTitle: item?.snippet?.videoOwnerChannelTitle ?? null,
            publishedAt: item?.contentDetails?.videoPublishedAt ?? null,
            position: item?.snippet?.position ?? null,
            thumbnail: item?.snippet?.thumbnails?.high?.url
                ?? item?.snippet?.thumbnails?.medium?.url
                ?? item?.snippet?.thumbnails?.default?.url
                ?? null,
            status: "QUEUED",
            createdAt: new Date(),
            updatedAt: new Date(),
        }, { merge: true });
    }
    await batch.commit();
}
