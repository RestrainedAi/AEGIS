"use strict";

// Start the yt-upload-job Cloud Run Job at most once per burst of publish clicks.
// - Concurrent calls in this instance share one in-flight request.
// - If an execution is already running (from any instance or the nightly
//   schedule), reuse it instead of starting another; the job drains rows that
//   are queued while it runs.
// - A short cooldown covers the gap between "run started" and "execution listed".

function createUploadJobTrigger({
  fetchImpl = globalThis.fetch,
  project,
  region = "us-central1",
  jobName = "yt-upload-job",
  cooldownMs = 60 * 1000,
  activeMaxAgeMs = 2 * 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const jobUrl = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${jobName}`;
  let inFlight = null;
  let last = null; // { at, execution }

  async function findActiveExecution(accessToken) {
    const resp = await fetchImpl(`${jobUrl}/executions?pageSize=10`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null; // listing is best-effort; never block a publish on it
    const data = await resp.json();
    for (const ex of data.executions || []) {
      if (ex.completionTime) continue;
      const created = Date.parse(ex.createTime || "");
      if (Number.isFinite(created) && now() - created > activeMaxAgeMs) continue;
      return String(ex.name || "").split("/").pop();
    }
    return null;
  }

  async function startRun(accessToken) {
    const resp = await fetchImpl(`${jobUrl}:run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!resp.ok) {
      const text = await resp.text();
      const err = new Error(`Cloud Run trigger failed: HTTP ${resp.status}`);
      err.status = resp.status;
      err.detail = String(text || "").slice(0, 400);
      throw err;
    }
    const data = await resp.json();
    // Operation metadata carries the execution name; fall back to the op name.
    const name = data?.metadata?.name || data?.name || "";
    return String(name).split("/").pop();
  }

  async function trigger(accessToken) {
    if (last && now() - last.at < cooldownMs) {
      return { execution: last.execution, reused: true, reason: "cooldown" };
    }
    if (inFlight) return { ...(await inFlight), reused: true, reason: "in-flight" };
    inFlight = (async () => {
      const active = await findActiveExecution(accessToken);
      if (active) {
        last = { at: now(), execution: active };
        return { execution: active, reused: true, reason: "running" };
      }
      const execution = await startRun(accessToken);
      last = { at: now(), execution };
      return { execution, reused: false, reason: "started" };
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return { trigger, findActiveExecution };
}

module.exports = { createUploadJobTrigger };
