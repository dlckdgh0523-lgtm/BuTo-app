import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import type { RuntimeReadinessSummary } from "../../../../packages/contracts/src/index.ts";
import type { ChecklistSectionSummary } from "./release-status-report.ts";
import { formatReleaseStatusReport } from "./release-status-report.ts";
import { formatRuntimeReadinessMarkdown } from "./runtime-readiness-report.ts";

export interface SubmissionBundleDocument {
  sourcePath: string;
  targetFileName?: string;
  title: string;
}

export interface SubmissionBundleEnvSource {
  sourcePath: string;
}

export interface SubmissionBundleReleaseStatusInput {
  checklistSections: ChecklistSectionSummary[];
  recentBundles: string[];
}

export interface SubmissionBundleManifest {
  bundleLabel: string;
  environmentLabel: string;
  generatedAt: string;
  readiness: Pick<RuntimeReadinessSummary, "overallStatus" | "blockers" | "warnings">;
  documents: Array<{
    fileName: string;
    title: string;
    sourcePath: string;
  }>;
  envFiles?: Array<{
    fileName: string;
    owner: RuntimeReadinessSummary["owners"][number]["owner"];
  }>;
}

export function formatSubmissionBundleIndex(input: {
  bundleLabel: string;
  environmentLabel: string;
  generatedAt: string;
  readiness: Pick<RuntimeReadinessSummary, "overallStatus" | "blockers" | "warnings">;
  documents: SubmissionBundleManifest["documents"];
}) {
  const lines = [
    "# BUTO Submission Bundle",
    "",
    `- Bundle label: \`${input.bundleLabel}\``,
    `- Environment: \`${input.environmentLabel}\``,
    `- Generated at: \`${input.generatedAt}\``,
    `- Runtime readiness: \`${input.readiness.overallStatus}\``,
    `- Blockers: \`${input.readiness.blockers}\``,
    `- Warnings: \`${input.readiness.warnings}\``,
    "",
    "## Included Files",
    ""
  ];

  for (const document of input.documents) {
    lines.push(`- \`${document.fileName}\` — ${document.title}`);
  }

  lines.push("");
  lines.push("## Release Note");
  lines.push("");

  if (input.readiness.blockers > 0) {
    lines.push("- This bundle is not launch-ready yet. Clear every blocker before submitting for launch review.");
  } else if (input.readiness.warnings > 0) {
    lines.push("- This bundle has warnings only. Risk Ops and release owner must explicitly accept the remaining warnings.");
  } else {
    lines.push("- This bundle has no unresolved blocker or warning in runtime readiness.");
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderOwnerLabel(owner: RuntimeReadinessSummary["owners"][number]["owner"]) {
  switch (owner) {
    case "INFRA":
      return "Infrastructure";
    case "SECURITY":
      return "Security";
    case "PARTNERSHIP":
      return "Partnership";
    case "BACKEND":
      return "Backend";
    case "RISK_OPS":
      return "Risk Ops";
  }
}

function parseEnvExample(content: string) {
  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    map.set(key, line);
  }

  return map;
}

function buildEnvExampleMap(sources: SubmissionBundleEnvSource[] | undefined) {
  const map = new Map<string, string>();
  for (const source of sources ?? []) {
    const content = readFileSync(resolve(source.sourcePath), "utf8");
    for (const [key, line] of parseEnvExample(content)) {
      if (!map.has(key)) {
        map.set(key, line);
      }
    }
  }

  return map;
}

function filterReadinessByOwner(readiness: RuntimeReadinessSummary, owner: RuntimeReadinessSummary["owners"][number]["owner"]): RuntimeReadinessSummary {
  return {
    ...readiness,
    checks: readiness.checks.filter((check) => check.owner === owner),
    owners: readiness.owners.filter((item) => item.owner === owner),
    blockers: readiness.checks.filter((check) => check.owner === owner && check.status === "BLOCK").length,
    warnings: readiness.checks.filter((check) => check.owner === owner && check.status === "WARN").length
  };
}

export function formatOwnerActionPlan(input: {
  bundleLabel: string;
  environmentLabel: string;
  readiness: RuntimeReadinessSummary;
}) {
  const lines = [
    "# BUTO Owner Action Plan",
    "",
    `- Bundle label: \`${input.bundleLabel}\``,
    `- Environment: \`${input.environmentLabel}\``,
    `- Overall status: \`${input.readiness.overallStatus}\``,
    ""
  ];

  for (const owner of input.readiness.owners) {
    const checks = input.readiness.checks.filter((check) => check.owner === owner.owner && check.status !== "PASS");
    lines.push(`## ${renderOwnerLabel(owner.owner)}`);
    lines.push("");
    lines.push(`- Open blockers: \`${owner.blockers}\``);
    lines.push(`- Open warnings: \`${owner.warnings}\``);
    lines.push("");

    if (checks.length === 0) {
      lines.push("- No open action remains for this owner.");
      lines.push("");
      continue;
    }

    for (const check of checks) {
      lines.push(`### ${check.title}`);
      lines.push(`- Status: \`${check.status}\``);
      lines.push(`- Detail: ${check.detail}`);
      lines.push(`- Action: ${check.remediation}`);
      if (check.envKeys?.length) {
        lines.push(`- Env keys: ${check.envKeys.map((envKey) => `\`${envKey}\``).join(", ")}`);
      }
      if (check.references?.length) {
        lines.push(`- References: ${check.references.map((reference) => `\`${reference}\``).join(", ")}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatOwnerEnvHandoff(input: {
  bundleLabel: string;
  environmentLabel: string;
  readiness: RuntimeReadinessSummary;
  envExampleMap?: Map<string, string>;
  envSources?: SubmissionBundleEnvSource[];
}) {
  const envExampleMap = input.envExampleMap ?? buildEnvExampleMap(input.envSources);
  const lines = [
    "# BUTO Owner Env Handoff",
    "",
    `- Bundle label: \`${input.bundleLabel}\``,
    `- Environment: \`${input.environmentLabel}\``,
    ""
  ];

  for (const owner of input.readiness.owners) {
    const keys = Array.from(
      new Set(
        input.readiness.checks
          .filter((check) => check.owner === owner.owner && check.status !== "PASS")
          .flatMap((check) => check.envKeys ?? [])
      )
    );

    lines.push(`## ${renderOwnerLabel(owner.owner)}`);
    lines.push("");

    if (keys.length === 0) {
      lines.push("- No unresolved env handoff item remains for this owner.");
      lines.push("");
      continue;
    }

    for (const key of keys) {
      lines.push(`- ${envExampleMap.get(key) ?? `${key}=<fill-this-value>`}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function formatSingleOwnerEnvHandoff(input: {
  bundleLabel: string;
  environmentLabel: string;
  owner: RuntimeReadinessSummary["owners"][number]["owner"];
  readiness: RuntimeReadinessSummary;
  envExampleMap?: Map<string, string>;
  envSources?: SubmissionBundleEnvSource[];
}) {
  return formatOwnerEnvHandoff({
    bundleLabel: input.bundleLabel,
    environmentLabel: input.environmentLabel,
    readiness: filterReadinessByOwner(input.readiness, input.owner),
    envExampleMap: input.envExampleMap,
    envSources: input.envSources
  });
}

export function resolveSubmissionBundleOutput(baseDir: string, bundleLabel: string) {
  const normalizedLabel = bundleLabel.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return resolve(baseDir, normalizedLabel);
}

export function writeSubmissionBundle(input: {
  outputDir: string;
  bundleLabel: string;
  environmentLabel: string;
  generatedAt: string;
  readiness: RuntimeReadinessSummary;
  documents: SubmissionBundleDocument[];
  envSources?: SubmissionBundleEnvSource[];
  releaseStatus?: SubmissionBundleReleaseStatusInput;
}) {
  const outputDir = resolve(input.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const envExampleMap = buildEnvExampleMap(input.envSources);

  const manifestDocuments: SubmissionBundleManifest["documents"] = [];
  for (const document of input.documents) {
    const sourcePath = resolve(document.sourcePath);
    const fileName = document.targetFileName ?? basename(sourcePath);
    copyFileSync(sourcePath, join(outputDir, fileName));
    manifestDocuments.push({
      fileName,
      title: document.title,
      sourcePath
    });
  }

  const readinessMarkdown = formatRuntimeReadinessMarkdown(input.readiness, {
    environmentLabel: input.environmentLabel
  });
  writeFileSync(join(outputDir, "runtime-readiness-report.md"), readinessMarkdown, "utf8");
  writeFileSync(join(outputDir, "runtime-readiness-report.json"), `${JSON.stringify(input.readiness, null, 2)}\n`, "utf8");
  writeFileSync(
    join(outputDir, "owner-action-plan.md"),
    formatOwnerActionPlan({
      bundleLabel: input.bundleLabel,
      environmentLabel: input.environmentLabel,
      readiness: input.readiness
    }),
    "utf8"
  );
  writeFileSync(
    join(outputDir, "owner-env-handoff.md"),
    formatOwnerEnvHandoff({
      bundleLabel: input.bundleLabel,
      environmentLabel: input.environmentLabel,
      readiness: input.readiness,
      envExampleMap
    }),
    "utf8"
  );

  if (input.releaseStatus) {
    writeFileSync(
      join(outputDir, "release-status-snapshot.md"),
      formatReleaseStatusReport({
        generatedAt: input.generatedAt,
        environmentLabel: input.environmentLabel,
        readiness: input.readiness,
        checklistSections: input.releaseStatus.checklistSections,
        recentBundles: input.releaseStatus.recentBundles
      }),
      "utf8"
    );
  }

  const envFiles: NonNullable<SubmissionBundleManifest["envFiles"]> = [];
  for (const owner of input.readiness.owners) {
    const keys = Array.from(
      new Set(
        input.readiness.checks
          .filter((check) => check.owner === owner.owner && check.status !== "PASS")
          .flatMap((check) => check.envKeys ?? [])
      )
    );

    if (keys.length === 0) {
      continue;
    }

    const fileName = `${owner.owner.toLowerCase()}-env.example`;
    const lines = [
      `# ${renderOwnerLabel(owner.owner)} env handoff`,
      `# Bundle: ${input.bundleLabel}`,
      `# Environment: ${input.environmentLabel}`,
      ""
    ];
    for (const key of keys) {
      lines.push(envExampleMap.get(key) ?? `${key}=<fill-this-value>`);
    }
    lines.push("");
    writeFileSync(join(outputDir, fileName), `${lines.join("\n")}\n`, "utf8");
    envFiles.push({
      fileName,
      owner: owner.owner
    });
  }

  const documents = [
    ...manifestDocuments,
    {
      fileName: "runtime-readiness-report.md",
      title: "Runtime readiness markdown report",
      sourcePath: join(outputDir, "runtime-readiness-report.md")
    },
    {
      fileName: "runtime-readiness-report.json",
      title: "Runtime readiness JSON report",
      sourcePath: join(outputDir, "runtime-readiness-report.json")
    },
    {
      fileName: "owner-action-plan.md",
      title: "Owner-based cutover action plan",
      sourcePath: join(outputDir, "owner-action-plan.md")
    },
    {
      fileName: "owner-env-handoff.md",
      title: "Owner-based env handoff",
      sourcePath: join(outputDir, "owner-env-handoff.md")
    }
  ];

  if (input.releaseStatus) {
    documents.push({
      fileName: "release-status-snapshot.md",
      title: "Release status snapshot",
      sourcePath: join(outputDir, "release-status-snapshot.md")
    });
  }

  const readme = formatSubmissionBundleIndex({
    bundleLabel: input.bundleLabel,
    environmentLabel: input.environmentLabel,
    generatedAt: input.generatedAt,
    readiness: input.readiness,
    documents
  });
  writeFileSync(join(outputDir, "README.md"), readme, "utf8");

  const manifest: SubmissionBundleManifest = {
    bundleLabel: input.bundleLabel,
    environmentLabel: input.environmentLabel,
    generatedAt: input.generatedAt,
    readiness: {
      overallStatus: input.readiness.overallStatus,
      blockers: input.readiness.blockers,
      warnings: input.readiness.warnings
    },
    documents,
    envFiles
  };
  writeFileSync(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    outputDir,
    manifest
  };
}
