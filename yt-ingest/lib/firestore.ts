import { Firestore } from "@google-cloud/firestore";

export const db = new Firestore();

export function ytRunRef(runId: string) {
  return db.collection("yt_runs").doc(runId);
}	
