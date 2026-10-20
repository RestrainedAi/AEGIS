import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONFIG_DIR,
  FEATURES_DIR,
  REPORTS_DIR,
  REPO_ROOT,
  featureSuitePath,
  resolveRepoPath,
} from "./paths.mjs";

const MAX_OUTPUT_CHARS = 120_000;

function timestamp() {
  return new Date().toISOString();
}

function stampForFile() {
  return timestamp().replace(/[:.]/g, "-");
}

function truncate(text) {
  const value = String(text || "");
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`;
}

function logLine(prefix, message) {
  const line = `[${timestamp()}] ${prefix} ${message}`;
  console.log(line);
  return line;
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function commandExists(command) {
  const check = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    const child = spawn(check, [command], { stdio: "ignore", shell: process.platform === "win32" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function gcloudAuthAvailable() {
  return runCommand({
    command: process.platform === "win32" ? "gcloud" : "gcloud",
    args: ["auth", "print-access-token"],
    cwd: REPO_ROOT,
    timeoutMs: 30_000,
  })
    .then((result) => result.exitCode === 0)
    .catch(() => false);
}

function runCommand({ command, args = [], cwd, timeoutMs = 300_000, env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs)
        : null;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : exitCode ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

async function runHttpStep(step) {
  const method = (step.method || "GET").toUpperCase();
  const expectStatus = step.expectStatus ?? 200;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), step.timeoutMs ?? 30_000);

  try {
    const response = await fetch(step.url, { method, signal: controller.signal, redirect: "follow" });
    const bodySnippet = method === "HEAD" ? "" : truncate(await response.text());
    const ok = Array.isArray(expectStatus)
      ? expectStatus.includes(response.status)
      : response.status === expectStatus;

    return {
      exitCode: ok ? 0 : 1,
      stdout: `HTTP ${response.status} ${response.statusText}\n${bodySnippet}`.trim(),
      stderr: ok ? "" : `Expected status ${expectStatus}, got ${response.status}`,
      timedOut: false,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error?.name === "AbortError" ? "Request timed out" : String(error),
      timedOut: error?.name === "AbortError",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runStep(step, options) {
  const startedAt = timestamp();
  const cwd = resolveRepoPath(step.cwd || ".");
  const baseResult = {
    id: step.id,
    title: step.title,
    type: step.type,
    deployPhase: step.deployPhase || "pre-deploy",
    startedAt,
  };

  if (step.deployPhase && options.phase !== "all") {
    const allowed =
      options.phase === step.deployPhase ||
      (options.phase === "pre-deploy" && step.deployPhase === "both") ||
      (options.phase === "post-deploy" && step.deployPhase === "both");
    if (!allowed) {
      return {
        ...baseResult,
        status: "skipped",
        completedAt: timestamp(),
        durationMs: 0,
        message: `Skipped for phase=${options.phase}`,
      };
    }
  }

  if (step.requiresGcp) {
    const hasAuth = await gcloudAuthAvailable();
    if (!hasAuth) {
      return {
        ...baseResult,
        status: step.optional ? "skipped" : "failed",
        completedAt: timestamp(),
        durationMs: 0,
        stderr: "GCP auth unavailable. Run: gcloud auth login && gcloud auth application-default login",
        suggestions: step.onFail?.suggestions || [
          "Run gcloud auth login",
          "Run gcloud auth application-default login",
          "Set project: gcloud config set project stable-framing-482501-t9",
        ],
        optional: Boolean(step.optional),
      };
    }
  }

  if (step.type === "manual") {
    if (!options.includeManual) {
      return {
        ...baseResult,
        status: "skipped",
        completedAt: timestamp(),
        durationMs: 0,
        message: "Manual step skipped. Re-run with --include-manual to require it.",
        checklist: step.checklist || [],
      };
    }
    return {
      ...baseResult,
      status: "passed",
      completedAt: timestamp(),
      durationMs: 0,
      message: "Manual checklist acknowledged (--include-manual). Operator must still verify live behavior.",
      checklist: step.checklist || [],
    };
  }

  if (step.type === "suite") {
    const nested = await runFeatureSuite(step.featureId, {
      ...options,
      nested: true,
      phase: step.phase || options.phase,
    });
    return {
      ...baseResult,
      status: nested.status,
      completedAt: nested.completedAt,
      durationMs: nested.durationMs,
      stdout: nested.summary,
      stderr: nested.failure?.stderr || "",
      suggestions: nested.failure?.suggestions || [],
      nestedReportPath: nested.reportPath,
    };
  }

  let result;
  if (step.type === "http") {
    result = await runHttpStep(step);
  } else if (step.type === "node-test") {
    result = await runCommand({
      command: "npm",
      args: ["test"],
      cwd: resolveRepoPath(step.cwd || "suno-viewer"),
      timeoutMs: step.timeoutMs,
    });
  } else if (step.type === "command") {
    const parts = String(step.command).split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);
    result = await runCommand({
      command,
      args: step.args || args,
      cwd,
      timeoutMs: step.timeoutMs,
      env: step.env,
    });
  } else {
    return {
      ...baseResult,
      status: "failed",
      completedAt: timestamp(),
      durationMs: 0,
      stderr: `Unknown step type: ${step.type}`,
      suggestions: ["Fix suite.json step definition"],
    };
  }

  const completedAt = timestamp();
  const passed = result.exitCode === 0;
  return {
    ...baseResult,
    status: passed ? "passed" : step.optional ? "skipped" : "failed",
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    exitCode: result.exitCode,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    timedOut: result.timedOut,
    suggestions: passed ? [] : step.onFail?.suggestions || [],
    fixCommands: passed ? [] : step.onFail?.fixCommands || [],
    optional: Boolean(step.optional),
  };
}

function printStepResult(stepResult, featureId) {
  const label = `${featureId} :: ${stepResult.id} :: ${stepResult.title}`;
  if (stepResult.status === "passed") {
    logLine("PASS", label);
    return;
  }
  if (stepResult.status === "skipped") {
    logLine("SKIP", `${label} — ${stepResult.message || "skipped"}`);
    return;
  }

  logLine("FAIL", label);
  if (stepResult.stderr) console.error(stepResult.stderr);
  if (stepResult.stdout) console.log(stepResult.stdout);
  if (stepResult.suggestions?.length) {
    console.error("Suggestions:");
    for (const item of stepResult.suggestions) console.error(`  - ${item}`);
  }
  if (stepResult.fixCommands?.length) {
    console.error("Fix commands:");
    for (const item of stepResult.fixCommands) console.error(`  ${item}`);
  }
}

function buildMarkdownReport(report) {
  const lines = [
    `# Feature Test Report: ${report.featureId}`,
    "",
    `- Title: ${report.title}`,
    `- Status: **${report.status}**`,
    `- Phase: ${report.phase}`,
    `- Started: ${report.startedAt}`,
    `- Completed: ${report.completedAt}`,
    `- Duration: ${report.durationMs} ms`,
    "",
    "## Steps",
    "",
  ];

  for (const step of report.steps) {
    lines.push(`### ${step.id} — ${step.title}`);
    lines.push(`- Type: ${step.type}`);
    lines.push(`- Status: ${step.status}`);
    if (step.message) lines.push(`- Note: ${step.message}`);
    if (step.stderr) {
      lines.push("");
      lines.push("```text");
      lines.push(step.stderr);
      lines.push("```");
    }
    if (step.suggestions?.length) {
      lines.push("");
      lines.push("Suggestions:");
      for (const item of step.suggestions) lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (report.failure) {
    lines.push("## Failure Summary");
    lines.push("");
    lines.push(`Stopped at **${report.failure.id}**: ${report.failure.title}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export async function runFeatureSuite(featureId, options = {}) {
  const suitePath = featureSuitePath(featureId);
  const suite = await loadJson(suitePath);
  const phase = options.phase || "pre-deploy";
  const startedAt = timestamp();
  const reportDir = path.join(REPORTS_DIR, stampForFile());
  if (!options.nested) {
    await mkdir(reportDir, { recursive: true });
  }

  logLine("SUITE", `Starting ${featureId} (${suite.title}) phase=${phase}`);

  const steps = [];
  let failure = null;

  for (const step of suite.steps) {
    logLine("STEP", `${featureId} :: ${step.id} :: ${step.title}`);
    const stepResult = await runStep(step, options);
    steps.push(stepResult);
    printStepResult(stepResult, featureId);

    if (stepResult.status === "failed") {
      failure = stepResult;
      break;
    }
  }

  const completedAt = timestamp();
  const status = failure ? "failed" : "passed";
  const report = {
    featureId,
    title: suite.title,
    phase,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    status,
    steps,
    failure,
    summary: `${featureId} ${status} (${steps.filter((s) => s.status === "passed").length}/${steps.length} steps passed)`,
  };

  const reportPath = path.join(reportDir, `${featureId}.json`);
  const markdownPath = path.join(reportDir, `${featureId}.md`);
  if (!options.nested) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, buildMarkdownReport(report), "utf8");
    logLine("REPORT", reportPath);
  }

  return { ...report, reportPath };
}

export async function runAllSuites(options = {}) {
  const order = await loadJson(path.join(CONFIG_DIR, "suite-order.json"));
  const phase = options.phase || "pre-deploy";
  const reports = [];
  const passed = new Set();
  const pending = [...order.suites];

  while (pending.length) {
    const entry = pending.shift();
    if ((entry.dependsOn || []).some((dep) => !passed.has(dep))) {
      pending.push(entry);
      if (pending.length === 1) {
        throw new Error(`Dependency deadlock before suite ${entry.featureId}`);
      }
      continue;
    }

    if (entry.deployPhase !== "both" && phase !== "all" && entry.deployPhase !== phase) {
      logLine("SKIP", `Suite ${entry.featureId} skipped for phase=${phase}`);
      passed.add(entry.featureId);
      continue;
    }

    const report = await runFeatureSuite(entry.featureId, options);
    reports.push(report);

    if (report.status !== "passed") {
      logLine("STOP", `Master run halted at ${entry.featureId}. Fix failures before deploy.`);
      return { status: "failed", phase, reports, failedFeature: entry.featureId };
    }

    passed.add(entry.featureId);
    for (const nextId of entry.triggersOnPass || []) {
      if (!passed.has(nextId) && !pending.some((item) => item.featureId === nextId)) {
        pending.push({
          featureId: nextId,
          dependsOn: [entry.featureId],
          deployPhase: "both",
        });
      }
    }
  }

  return { status: "passed", phase, reports };
}
