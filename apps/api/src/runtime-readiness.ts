import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadApiRuntimeConfig } from "./env.ts";
import { formatRuntimeReadinessMarkdown } from "./modules/runtime-readiness-report.ts";
import { RuntimeReadinessService } from "./modules/runtime-readiness.service.ts";

function readArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function emitOutput(content: string, outputPath?: string) {
  if (!outputPath) {
    console.log(content);
    return;
  }

  const absolutePath = resolve(outputPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
  console.log(`Wrote readiness report to ${absolutePath}`);
}

const runtimeConfig = loadApiRuntimeConfig();
const readiness = new RuntimeReadinessService(runtimeConfig, process.env).evaluate();
const format = readArgValue("--format") ?? "json";
const outputPath = readArgValue("--output");
const environmentLabel = readArgValue("--environment") ?? process.env.NODE_ENV ?? "production";
const softExit = process.argv.includes("--soft-exit");

if (readiness.resultType === "ERROR") {
  console.error(JSON.stringify(readiness, null, 2));
  process.exit(1);
}

const summary = readiness.success;
if (format === "markdown") {
  emitOutput(
    formatRuntimeReadinessMarkdown(summary, {
      environmentLabel
    }),
    outputPath
  );
} else {
  emitOutput(JSON.stringify(summary, null, 2), outputPath);
}

if (!softExit && summary.blockers > 0) {
  process.exit(1);
}

if (!softExit && process.argv.includes("--strict-warn") && summary.warnings > 0) {
  process.exit(1);
}
