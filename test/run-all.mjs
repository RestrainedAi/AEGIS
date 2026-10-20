#!/usr/bin/env node
import { runAllSuites } from "./runners/lib/runner-core.mjs";

function parseArgs(argv) {
  const options = { phase: "pre-deploy", includeManual: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--phase" && argv[i + 1]) options.phase = argv[++i];
    if (arg === "--include-manual") options.includeManual = true;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

runAllSuites(options)
  .then((result) => {
    console.log(`Master suite ${result.status} (phase=${result.phase})`);
    if (result.failedFeature) {
      console.error(`Failed feature: ${result.failedFeature}`);
    }
    process.exit(result.status === "passed" ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
