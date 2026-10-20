#!/usr/bin/env node
import { runFeatureSuite } from "./lib/runner-core.mjs";

function parseArgs(argv) {
  const options = { phase: "all", includeManual: false };
  let featureId = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--phase" && argv[i + 1]) {
      options.phase = argv[++i];
    } else if (arg === "--include-manual") {
      options.includeManual = true;
    } else if (!arg.startsWith("-")) {
      featureId = arg;
    }
  }

  if (!featureId) {
    console.error("Usage: node runners/run-feature-suite.mjs <featureId> [--phase pre-deploy|post-deploy|all] [--include-manual]");
    process.exit(2);
  }

  return { featureId, options };
}

const { featureId, options } = parseArgs(process.argv.slice(2));

runFeatureSuite(featureId, options)
  .then((report) => {
    console.log(report.summary);
    process.exit(report.status === "passed" ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
