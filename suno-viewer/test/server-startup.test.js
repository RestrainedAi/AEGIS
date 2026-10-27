// Startup smoke test: spawn server.js with safe env vars and fail if it crashes at boot.
// No secrets, no real GCS writes: nothing is requested, the process is killed once it listens.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

test("server.js starts without crashing", { timeout: 60000 }, async () => {
  const port = String(20000 + Math.floor(Math.random() * 20000));
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    PORT: port,
    NODE_ENV: "test",
    GOOGLE_CLOUD_PROJECT: "startup-test-no-project",
    GOOGLE_APPLICATION_CREDENTIALS: path.join(__dirname, "does-not-exist.json"),
  };
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."), env, stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server did not listen within 45s\n" + out)), 45000);
      child.stdout.on("data", () => { if (out.includes("Listening on")) { clearTimeout(timer); resolve(); } });
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited early (code ${code})\n` + out)); });
    });
    await new Promise((r) => setTimeout(r, 1500)); // catch crashes right after listen
    assert.strictEqual(child.exitCode, null, "server crashed after listening\n" + out);
    assert.doesNotMatch(out, /ReferenceError|TypeError|SyntaxError/);
  } finally {
    child.kill();
  }
});