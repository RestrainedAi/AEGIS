"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.ytRunRef = ytRunRef;
const firestore_1 = require("@google-cloud/firestore");
exports.db = new firestore_1.Firestore();
function ytRunRef(runId) {
    return exports.db.collection("yt_runs").doc(runId);
}
