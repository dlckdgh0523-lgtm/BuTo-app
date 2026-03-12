import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadApiRuntimeConfig } from "./env.ts";
import { findRecentBundleNames, parseChecklistSummary } from "./modules/release-status-report.ts";
import { RuntimeReadinessService } from "./modules/runtime-readiness.service.ts";
import { resolveSubmissionBundleOutput, writeSubmissionBundle } from "./modules/submission-bundle.ts";

function readArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

const environmentLabel = readArgValue("--environment") ?? process.env.NODE_ENV ?? "production";
const bundleLabel = readArgValue("--bundle-label") ?? `release-candidate-${new Date().toISOString().slice(0, 10)}`;
const allowWarnings = process.argv.includes("--allow-warnings");
const allowBlockers = process.argv.includes("--allow-blockers");
const outputPath =
  readArgValue("--output") ??
  resolveSubmissionBundleOutput(resolve(process.cwd(), "../../docs/submission/bundles"), bundleLabel);

const runtimeConfig = loadApiRuntimeConfig();
const readiness = new RuntimeReadinessService(runtimeConfig, process.env).evaluate();

if (readiness.resultType === "ERROR") {
  console.error(JSON.stringify(readiness, null, 2));
  process.exit(1);
}

const generatedAt = new Date().toISOString();
const checklistPath = resolve(process.cwd(), "../../docs/apps-in-toss-release-checklist.md");
const bundlesDir = resolve(process.cwd(), "../../docs/submission/bundles");
const result = writeSubmissionBundle({
  outputDir: outputPath,
  bundleLabel,
  environmentLabel,
  generatedAt,
  readiness: readiness.success,
  documents: [
    {
      sourcePath: resolve(process.cwd(), "../../docs/submission/app-registration-packet.md"),
      title: "App registration packet"
    },
    {
      sourcePath: resolve(process.cwd(), "../../docs/submission/launch-qa-report-template.md"),
      title: "Launch QA report template"
    },
    {
      sourcePath: resolve(process.cwd(), "../../docs/apps-in-toss-release-checklist.md"),
      title: "Apps-in-Toss release checklist"
    },
    {
      sourcePath: resolve(process.cwd(), "../../docs/ops/runtime-cutover-runbook.md"),
      title: "Runtime cutover runbook"
    },
    {
      sourcePath: resolve(process.cwd(), "../../docs/ops/proof-storage-s3-runbook.md"),
      title: "Proof storage S3 runbook"
    }
  ],
  envSources: [
    {
      sourcePath: resolve(process.cwd(), "../api/.env.production.example")
    },
    {
      sourcePath: resolve(process.cwd(), "../../apps/miniapp/.env.production.example")
    }
  ],
  releaseStatus: {
    checklistSections: parseChecklistSummary(readFileSync(checklistPath, "utf8")),
    recentBundles: findRecentBundleNames(bundlesDir)
  }
});

console.log(`Wrote preflight bundle to ${result.outputDir}`);
console.log(
  `Readiness summary: ${readiness.success.overallStatus} | BLOCK ${readiness.success.blockers} | WARN ${readiness.success.warnings}`
);

if (!allowBlockers && readiness.success.blockers > 0) {
  process.exit(1);
}

if (!allowWarnings && readiness.success.warnings > 0) {
  process.exit(1);
}
