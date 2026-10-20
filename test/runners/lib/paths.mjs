import path from "path";
import { fileURLToPath } from "url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TEST_ROOT = path.resolve(THIS_DIR, "../..");
export const REPO_ROOT = path.resolve(TEST_ROOT, "..");
export const FEATURES_DIR = path.join(TEST_ROOT, "features");
export const CONFIG_DIR = path.join(TEST_ROOT, "config");
export const REPORTS_DIR = path.join(TEST_ROOT, "reports");
export const SCRIPTS_DIR = path.join(TEST_ROOT, "scripts");

export function featureSuitePath(featureId) {
  return path.join(FEATURES_DIR, featureId, "suite.json");
}

export function resolveRepoPath(relativePath = ".") {
  return path.resolve(REPO_ROOT, relativePath);
}
