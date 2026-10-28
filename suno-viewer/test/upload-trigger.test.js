const test = require("node:test");
const assert = require("node:assert/strict");
const { createUploadJobTrigger } = require("../upload-trigger.cjs");

function fakeRun({ executions = [] } = {}) {
  const calls = { list: 0, run: 0 };
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes("/executions")) {
      calls.list += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, json: async () => ({ executions }) };
    }
    if (url.endsWith(":run") && opts.method === "POST") {
      calls.run += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, json: async () => ({ metadata: { name: `p/executions/yt-upload-job-${calls.run}` } }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}

test("a burst of publish clicks starts exactly one job run", async () => {
  const f = fakeRun();
  const t = createUploadJobTrigger({ fetchImpl: f.fetchImpl, project: "p" });
  const results = await Promise.all(Array.from({ length: 10 }, () => t.trigger("tok")));
  assert.equal(f.calls.run, 1);
  assert.equal(new Set(results.map((r) => r.execution)).size, 1);
  assert.equal(results.filter((r) => !r.reused).length, 1);
});

test("clicks within the cooldown reuse the run", async () => {
  let clock = 1_000_000;
  const f = fakeRun();
  const t = createUploadJobTrigger({ fetchImpl: f.fetchImpl, project: "p", now: () => clock });
  await t.trigger("tok");
  clock += 30_000;
  const again = await t.trigger("tok");
  assert.equal(f.calls.run, 1);
  assert.equal(again.reason, "cooldown");
  clock += 60_000;
  await t.trigger("tok");
  assert.equal(f.calls.run, 2);
});

test("an already-running execution is reused, not duplicated", async () => {
  const f = fakeRun({
    executions: [
      { name: "p/executions/old", createTime: new Date(Date.now() - 86400000).toISOString(), completionTime: "x" },
      { name: "p/executions/yt-upload-job-live", createTime: new Date().toISOString() },
    ],
  });
  const t = createUploadJobTrigger({ fetchImpl: f.fetchImpl, project: "p" });
  const r = await t.trigger("tok");
  assert.equal(f.calls.run, 0);
  assert.equal(r.execution, "yt-upload-job-live");
  assert.equal(r.reason, "running");
});

test("a stuck execution older than the max age does not block new runs", async () => {
  const f = fakeRun({ executions: [{ name: "p/executions/stuck", createTime: new Date(Date.now() - 5 * 3600000).toISOString() }] });
  const t = createUploadJobTrigger({ fetchImpl: f.fetchImpl, project: "p" });
  const r = await t.trigger("tok");
  assert.equal(f.calls.run, 1);
  assert.equal(r.reused, false);
});
