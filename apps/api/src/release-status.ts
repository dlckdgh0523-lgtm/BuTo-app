import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadApiRuntimeConfig } from "./env.ts";
import { buildReleaseSubmissionDecision, formatReleaseStatusReport, findRecentBundleNames, listRecentSubmissionBundles, parseChecklistSummary, recommendSubmissionBundle } from "./modules/release-status-report.ts";
import { RuntimeReadinessService } from "./modules/runtime-readiness.service.ts";

function readArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

const environmentLabel = readArgValue("--environment") ?? process.env.NODE_ENV ?? "production";
const outputPath = resolve(
  readArgValue("--output") ?? resolve(process.cwd(), "../../docs/submission/release-status-snapshot.md")
);

const runtimeConfig = loadApiRuntimeConfig();
const readiness = new RuntimeReadinessService(runtimeConfig, process.env).evaluate();

if (readiness.resultType === "ERROR") {
  console.error(JSON.stringify(readiness, null, 2));
  process.exit(1);
}

const checklistMarkdown = readFileSync(resolve(process.cwd(), "../../docs/apps-in-toss-release-checklist.md"), "utf8");
const recentBundleSummaries = listRecentSubmissionBundles(resolve(process.cwd(), "../../docs/submission/bundles"), 5, readiness.success);
const recommendation = recommendSubmissionBundle(recentBundleSummaries);
const report = formatReleaseStatusReport({
  generatedAt: new Date().toISOString(),
  environmentLabel,
  readiness: readiness.success,
  checklistSections: parseChecklistSummary(checklistMarkdown),
  recentBundles: findRecentBundleNames(resolve(process.cwd(), "../../docs/submission/bundles")),
  recentBundleSummaries,
  recommendation,
  decision: buildReleaseSubmissionDecision({
    readiness: readiness.success,
    recommendation
  })
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, report, "utf8");
console.log(`Wrote release status snapshot to ${outputPath}`);
