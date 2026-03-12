import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { RuntimeReadinessSummary } from "../../../../packages/contracts/src/index.ts";

export interface ChecklistSectionSummary {
  title: string;
  checked: number;
  unchecked: number;
}

export interface SubmissionBundleSummary {
  bundleLabel: string;
  generatedAt: string;
  overallStatus: RuntimeReadinessSummary["overallStatus"];
  blockers: number;
  warnings: number;
  documentCount: number;
  envFileCount: number;
  integrityStatus: "COMPLETE" | "INCOMPLETE";
  missingFiles: string[];
  driftStatus: "IN_SYNC" | "STALE";
  driftReasons: string[];
}

export interface SubmissionBundleDetail extends SubmissionBundleSummary {
  readmeMarkdown: string;
  documents: Array<{
    fileName: string;
    title: string;
    sourcePath: string;
  }>;
  envFiles: Array<{
    fileName: string;
    owner: string;
  }>;
}

export interface SubmissionBundleRecommendation {
  recommendedBundleLabel: string | null;
  status: "READY_TO_SUBMIT" | "ACTION_REQUIRED";
  reasons: string[];
}

export interface ReleaseSubmissionDecision {
  decision: "BLOCKED" | "CONDITIONAL" | "READY";
  recommendedBundleLabel: string | null;
  summary: string;
  reasons: string[];
}

const requiredBundleFiles = [
  "README.md",
  "manifest.json",
  "runtime-readiness-report.md",
  "runtime-readiness-report.json",
  "owner-action-plan.md",
  "owner-env-handoff.md",
  "release-status-snapshot.md"
] as const;

function summarizeBundleIntegrity(bundleDir: string) {
  const existingFiles = new Set(readdirSync(bundleDir));
  const missingFiles = requiredBundleFiles.filter((fileName) => !existingFiles.has(fileName));
  return {
    integrityStatus: missingFiles.length === 0 ? "COMPLETE" : "INCOMPLETE",
    missingFiles
  } as const;
}

function summarizeBundleDrift(
  bundle: Pick<SubmissionBundleSummary, "overallStatus" | "blockers" | "warnings">,
  currentReadiness?: RuntimeReadinessSummary
) {
  if (!currentReadiness) {
    return {
      driftStatus: "IN_SYNC",
      driftReasons: []
    } as const;
  }

  const driftReasons: string[] = [];
  if (bundle.overallStatus !== currentReadiness.overallStatus) {
    driftReasons.push(`overallStatus ${bundle.overallStatus} -> ${currentReadiness.overallStatus}`);
  }
  if (bundle.blockers !== currentReadiness.blockers) {
    driftReasons.push(`blockers ${bundle.blockers} -> ${currentReadiness.blockers}`);
  }
  if (bundle.warnings !== currentReadiness.warnings) {
    driftReasons.push(`warnings ${bundle.warnings} -> ${currentReadiness.warnings}`);
  }

  return {
    driftStatus: driftReasons.length === 0 ? "IN_SYNC" : "STALE",
    driftReasons
  } as const;
}

export function parseChecklistSummary(markdown: string) {
  const sections: ChecklistSectionSummary[] = [];
  let current: ChecklistSectionSummary | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      current = {
        title: line.slice(3).trim(),
        checked: 0,
        unchecked: 0
      };
      sections.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("- [x]")) {
      current.checked += 1;
    } else if (line.startsWith("- [ ]")) {
      current.unchecked += 1;
    }
  }

  return sections;
}

export function findRecentBundleNames(bundlesDir: string, limit = 5) {
  try {
    return readdirSync(resolve(bundlesDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const absolutePath = resolve(bundlesDir, entry.name);
        return {
          name: entry.name,
          absolutePath,
          mtimeMs: statSync(absolutePath).mtimeMs
        };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, limit)
      .map((entry) => basename(entry.absolutePath));
  } catch {
    return [];
  }
}

export function listRecentSubmissionBundles(
  bundlesDir: string,
  limit = 10,
  currentReadiness?: RuntimeReadinessSummary
): SubmissionBundleSummary[] {
  try {
    return readdirSync(resolve(bundlesDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const absolutePath = resolve(bundlesDir, entry.name);
        const manifest = JSON.parse(readFileSync(resolve(absolutePath, "manifest.json"), "utf8")) as {
          bundleLabel?: string;
          generatedAt?: string;
          readiness?: {
            overallStatus?: RuntimeReadinessSummary["overallStatus"];
            blockers?: number;
            warnings?: number;
          };
          documents?: unknown[];
          envFiles?: unknown[];
        };
        const integrity = summarizeBundleIntegrity(absolutePath);
        const drift = summarizeBundleDrift(
          {
            overallStatus: manifest.readiness?.overallStatus ?? "ACTION_REQUIRED",
            blockers: Number(manifest.readiness?.blockers ?? 0),
            warnings: Number(manifest.readiness?.warnings ?? 0)
          },
          currentReadiness
        );

        return {
          bundleLabel: String(manifest.bundleLabel ?? entry.name),
          generatedAt: String(manifest.generatedAt ?? new Date(statSync(absolutePath).mtimeMs).toISOString()),
          overallStatus: manifest.readiness?.overallStatus ?? "ACTION_REQUIRED",
          blockers: Number(manifest.readiness?.blockers ?? 0),
          warnings: Number(manifest.readiness?.warnings ?? 0),
          documentCount: Array.isArray(manifest.documents) ? manifest.documents.length : 0,
          envFileCount: Array.isArray(manifest.envFiles) ? manifest.envFiles.length : 0,
          integrityStatus: integrity.integrityStatus,
          missingFiles: [...integrity.missingFiles],
          driftStatus: drift.driftStatus,
          driftReasons: [...drift.driftReasons],
          mtimeMs: statSync(absolutePath).mtimeMs
        };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, limit)
      .map(({ mtimeMs: _mtimeMs, ...bundle }) => bundle);
  } catch {
    return [];
  }
}

export function readSubmissionBundleDetail(
  bundlesDir: string,
  bundleLabel: string,
  currentReadiness?: RuntimeReadinessSummary
): SubmissionBundleDetail | null {
  try {
    const bundleDir = resolve(bundlesDir, bundleLabel);
    const manifest = JSON.parse(readFileSync(resolve(bundleDir, "manifest.json"), "utf8")) as {
      bundleLabel?: string;
      generatedAt?: string;
      readiness?: {
        overallStatus?: RuntimeReadinessSummary["overallStatus"];
        blockers?: number;
        warnings?: number;
      };
      documents?: Array<{
        fileName: string;
        title: string;
        sourcePath: string;
      }>;
      envFiles?: Array<{
        fileName: string;
        owner: string;
      }>;
    };
    const readmeMarkdown = readFileSync(resolve(bundleDir, "README.md"), "utf8");
    const integrity = summarizeBundleIntegrity(bundleDir);
    const drift = summarizeBundleDrift(
      {
        overallStatus: manifest.readiness?.overallStatus ?? "ACTION_REQUIRED",
        blockers: Number(manifest.readiness?.blockers ?? 0),
        warnings: Number(manifest.readiness?.warnings ?? 0)
      },
      currentReadiness
    );

    return {
      bundleLabel: String(manifest.bundleLabel ?? bundleLabel),
      generatedAt: String(manifest.generatedAt ?? new Date(statSync(bundleDir).mtimeMs).toISOString()),
      overallStatus: manifest.readiness?.overallStatus ?? "ACTION_REQUIRED",
      blockers: Number(manifest.readiness?.blockers ?? 0),
      warnings: Number(manifest.readiness?.warnings ?? 0),
      documentCount: Array.isArray(manifest.documents) ? manifest.documents.length : 0,
      envFileCount: Array.isArray(manifest.envFiles) ? manifest.envFiles.length : 0,
      integrityStatus: integrity.integrityStatus,
      missingFiles: [...integrity.missingFiles],
      driftStatus: drift.driftStatus,
      driftReasons: [...drift.driftReasons],
      readmeMarkdown,
      documents: Array.isArray(manifest.documents) ? manifest.documents : [],
      envFiles: Array.isArray(manifest.envFiles) ? manifest.envFiles : []
    };
  } catch {
    return null;
  }
}

export function recommendSubmissionBundle(bundles: SubmissionBundleSummary[]): SubmissionBundleRecommendation {
  const eligible = bundles
    .filter((bundle) => bundle.integrityStatus === "COMPLETE" && bundle.driftStatus === "IN_SYNC")
    .sort((left, right) => {
      if (left.blockers !== right.blockers) {
        return left.blockers - right.blockers;
      }
      if (left.warnings !== right.warnings) {
        return left.warnings - right.warnings;
      }
      return Date.parse(right.generatedAt) - Date.parse(left.generatedAt);
    });

  const top = eligible[0];
  if (top) {
    const reasons = [
      "필수 제출 파일이 모두 들어 있어요.",
      "현재 runtime readiness와 번들 상태가 일치해요.",
      `BLOCK ${top.blockers} · WARN ${top.warnings} 기준으로 가장 보수적인 후보예요.`
    ];
    return {
      recommendedBundleLabel: top.bundleLabel,
      status: top.blockers === 0 && top.warnings === 0 ? "READY_TO_SUBMIT" : "ACTION_REQUIRED",
      reasons
    };
  }

  const reasons: string[] = [];
  if (bundles.every((bundle) => bundle.integrityStatus !== "COMPLETE")) {
    reasons.push("필수 제출 파일이 모두 갖춰진 번들이 없어요.");
  }
  if (bundles.every((bundle) => bundle.driftStatus !== "IN_SYNC")) {
    reasons.push("현재 runtime readiness와 일치하는 최신 번들이 없어요.");
  }
  if (reasons.length === 0) {
    reasons.push("제출 후보를 자동으로 고를 수 없어요. 번들 상태를 수동으로 다시 확인해야 해요.");
  }

  return {
    recommendedBundleLabel: null,
    status: "ACTION_REQUIRED",
    reasons
  };
}

export function buildReleaseSubmissionDecision(input: {
  readiness: RuntimeReadinessSummary;
  recommendation: SubmissionBundleRecommendation;
}): ReleaseSubmissionDecision {
  if (input.readiness.blockers > 0) {
    return {
      decision: "BLOCKED",
      recommendedBundleLabel: input.recommendation.recommendedBundleLabel,
      summary: "출시 차단 항목이 남아 있어 제출하면 안 돼요.",
      reasons: [`runtime readiness blocker ${input.readiness.blockers}건이 남아 있어요.`, ...input.recommendation.reasons]
    };
  }

  if (!input.recommendation.recommendedBundleLabel) {
    return {
      decision: "BLOCKED",
      recommendedBundleLabel: null,
      summary: "제출 후보 번들을 아직 고를 수 없어요.",
      reasons: [...input.recommendation.reasons]
    };
  }

  if (input.readiness.warnings > 0 || input.recommendation.status !== "READY_TO_SUBMIT") {
    return {
      decision: "CONDITIONAL",
      recommendedBundleLabel: input.recommendation.recommendedBundleLabel,
      summary: "제출 전 운영 승인과 잔여 경고 확인이 필요해요.",
      reasons: [`runtime readiness warning ${input.readiness.warnings}건이 남아 있어요.`, ...input.recommendation.reasons]
    };
  }

  return {
    decision: "READY",
    recommendedBundleLabel: input.recommendation.recommendedBundleLabel,
    summary: "현재 기준으로는 제출 가능한 상태예요.",
    reasons: [...input.recommendation.reasons]
  };
}

export function formatReleaseStatusReport(input: {
  generatedAt: string;
  environmentLabel: string;
  readiness: RuntimeReadinessSummary;
  checklistSections: ChecklistSectionSummary[];
  recentBundles: string[];
  recentBundleSummaries?: SubmissionBundleSummary[];
  recommendation?: SubmissionBundleRecommendation;
  decision?: ReleaseSubmissionDecision;
}) {
  const lines = [
    "# BUTO Release Status Snapshot",
    "",
    `- Generated at: \`${input.generatedAt}\``,
    `- Environment: \`${input.environmentLabel}\``,
    `- Runtime readiness: \`${input.readiness.overallStatus}\``,
    `- Blockers: \`${input.readiness.blockers}\``,
    `- Warnings: \`${input.readiness.warnings}\``,
    ""
  ];

  lines.push("## Checklist Summary");
  lines.push("");
  for (const section of input.checklistSections) {
    lines.push(`- ${section.title}: COMPLETE ${section.checked} / PENDING ${section.unchecked}`);
  }
  lines.push("");

  lines.push("## Owner Summary");
  lines.push("");
  for (const owner of input.readiness.owners) {
    lines.push(`- ${owner.owner}: BLOCK ${owner.blockers} / WARN ${owner.warnings} / PASS ${owner.passing}`);
  }
  lines.push("");

  if (input.decision) {
    lines.push("## Release Decision");
    lines.push("");
    lines.push(`- Decision: \`${input.decision.decision}\``);
    lines.push(`- Summary: ${input.decision.summary}`);
    if (input.decision.recommendedBundleLabel) {
      lines.push(`- Recommended bundle: \`${input.decision.recommendedBundleLabel}\``);
    }
    for (const reason of input.decision.reasons) {
      lines.push(`- Reason: ${reason}`);
    }
    lines.push("");
  }

  if (input.recommendation) {
    lines.push("## Recommended Candidate");
    lines.push("");
    lines.push(`- Status: \`${input.recommendation.status}\``);
    lines.push(`- Bundle: \`${input.recommendation.recommendedBundleLabel ?? "none"}\``);
    for (const reason of input.recommendation.reasons) {
      lines.push(`- Reason: ${reason}`);
    }
    lines.push("");
  }

  if (input.recentBundleSummaries?.length) {
    lines.push("## Recent Bundle Health");
    lines.push("");
    for (const bundle of input.recentBundleSummaries) {
      lines.push(
        `- \`${bundle.bundleLabel}\` · ${bundle.overallStatus} · integrity ${bundle.integrityStatus} · drift ${bundle.driftStatus} · BLOCK ${bundle.blockers} / WARN ${bundle.warnings}`
      );
    }
    lines.push("");
  }

  lines.push("## Current Blockers");
  lines.push("");
  const blockers = input.readiness.checks.filter((check) => check.status === "BLOCK");
  if (blockers.length === 0) {
    lines.push("- No blocker remains.");
  } else {
    for (const check of blockers) {
      lines.push(`- [${check.owner}] ${check.title}`);
      lines.push(`  Next: ${check.remediation}`);
      if (check.envKeys?.length) {
        lines.push(`  Env: ${check.envKeys.join(", ")}`);
      }
    }
  }
  lines.push("");

  lines.push("## Recent Bundles");
  lines.push("");
  if (input.recentBundles.length === 0) {
    lines.push("- No submission bundle has been generated yet.");
  } else {
    for (const bundle of input.recentBundles) {
      lines.push(`- \`docs/submission/bundles/${bundle}\``);
    }
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}
