import type { RuntimeReadinessSummary } from "../../../../packages/contracts/src/index.ts";

function renderStatusBadge(status: "READY" | "WARN" | "ACTION_REQUIRED") {
  switch (status) {
    case "READY":
      return "READY";
    case "WARN":
      return "WARN";
    case "ACTION_REQUIRED":
      return "ACTION REQUIRED";
  }
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

export function formatRuntimeReadinessMarkdown(
  summary: RuntimeReadinessSummary,
  options?: {
    title?: string;
    environmentLabel?: string;
  }
) {
  const title = options?.title ?? "BUTO Runtime Readiness Report";
  const environmentLabel = options?.environmentLabel ?? "production";
  const lines = [
    `# ${title}`,
    "",
    `- Environment: \`${environmentLabel}\``,
    `- Checked at: \`${summary.checkedAt}\``,
    `- Overall status: \`${renderStatusBadge(summary.overallStatus)}\``,
    `- Blockers: \`${summary.blockers}\``,
    `- Warnings: \`${summary.warnings}\``,
    ""
  ];

  lines.push("## Owner Summary");
  lines.push("");
  for (const owner of summary.owners) {
    lines.push(`- ${renderOwnerLabel(owner.owner)}: BLOCK ${owner.blockers} / WARN ${owner.warnings} / PASS ${owner.passing} / TOTAL ${owner.total}`);
  }
  lines.push("");
  lines.push("## Cutover Order");
  lines.push("");
  lines.push("1. INFRA");
  lines.push("2. SECURITY");
  lines.push("3. PARTNERSHIP");
  lines.push("4. BACKEND");
  lines.push("5. RISK_OPS");
  lines.push("");
  lines.push("## Checks");
  lines.push("");

  for (const check of summary.checks) {
    lines.push(`### ${check.title}`);
    lines.push(`- Key: \`${check.key}\``);
    lines.push(`- Status: \`${check.status}\``);
    lines.push(`- Owner: \`${check.owner}\``);
    lines.push(`- Detail: ${check.detail}`);
    lines.push(`- Next action: ${check.remediation}`);
    if (check.envKeys?.length) {
      lines.push(`- Env keys: ${check.envKeys.map((envKey) => `\`${envKey}\``).join(", ")}`);
    }
    if (check.references && check.references.length > 0) {
      lines.push(`- References: ${check.references.map((reference) => `\`${reference}\``).join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Launch Decision");
  lines.push("");

  if (summary.blockers > 0) {
    lines.push("- Launch should stay blocked until every `BLOCK` item is cleared.");
  } else if (summary.warnings > 0) {
    lines.push("- Launch can proceed only if Risk Ops and release owner explicitly accept the remaining `WARN` items.");
  } else {
    lines.push("- No unresolved blocker or warning remains in this snapshot.");
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}
