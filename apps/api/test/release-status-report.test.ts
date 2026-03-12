import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseSubmissionDecision, formatReleaseStatusReport, listRecentSubmissionBundles, parseChecklistSummary, readSubmissionBundleDetail, recommendSubmissionBundle } from "../src/modules/release-status-report.ts";

test("parseChecklistSummary counts checked and unchecked items per section", () => {
  const sections = parseChecklistSummary(`
## Runtime
- [x] One
- [ ] Two

## Submission
- [x] Three
`);

  assert.deepEqual(sections, [
    { title: "Runtime", checked: 1, unchecked: 1 },
    { title: "Submission", checked: 1, unchecked: 0 }
  ]);
});

test("formatReleaseStatusReport renders readiness, checklist, and bundles", () => {
  const markdown = formatReleaseStatusReport({
    generatedAt: "2026-03-10T12:00:00.000Z",
    environmentLabel: "production",
    checklistSections: [
      { title: "Runtime", checked: 3, unchecked: 2 },
      { title: "Submission packet", checked: 4, unchecked: 1 }
    ],
    recentBundles: ["owner-env-rehearsal", "rc-rehearsal"],
    recentBundleSummaries: [
      {
        bundleLabel: "owner-env-rehearsal",
        generatedAt: "2026-03-10T11:00:00.000Z",
        overallStatus: "ACTION_REQUIRED",
        blockers: 2,
        warnings: 1,
        documentCount: 7,
        envFileCount: 4,
        integrityStatus: "COMPLETE",
        missingFiles: [],
        driftStatus: "IN_SYNC",
        driftReasons: []
      }
    ],
    recommendation: {
      recommendedBundleLabel: "owner-env-rehearsal",
      status: "ACTION_REQUIRED",
      reasons: ["필수 제출 파일이 모두 들어 있어요."]
    },
    decision: {
      decision: "BLOCKED",
      recommendedBundleLabel: "owner-env-rehearsal",
      summary: "출시 차단 항목이 남아 있어 제출하면 안 돼요.",
      reasons: ["runtime readiness blocker 2건이 남아 있어요."]
    },
    readiness: {
      overallStatus: "ACTION_REQUIRED",
      checkedAt: "2026-03-10T12:00:00.000Z",
      blockers: 2,
      warnings: 1,
      owners: [
        {
          owner: "INFRA",
          blockers: 1,
          warnings: 0,
          passing: 2,
          total: 3
        }
      ],
      checks: [
        {
          key: "database",
          status: "BLOCK",
          title: "데이터베이스 연결",
          detail: "DB 없음",
          owner: "INFRA",
          remediation: "DB 연결",
          envKeys: ["BUTO_DATABASE_URL"]
        },
        {
          key: "strict-runtime-flags",
          status: "WARN",
          title: "strict runtime 검사",
          detail: "warn",
          owner: "BACKEND",
          remediation: "strict on"
        }
      ]
    }
  });

  assert.match(markdown, /# BUTO Release Status Snapshot/);
  assert.match(markdown, /Runtime readiness: `ACTION_REQUIRED`/);
  assert.match(markdown, /Runtime: COMPLETE 3 \/ PENDING 2/);
  assert.match(markdown, /## Release Decision/);
  assert.match(markdown, /Decision: `BLOCKED`/);
  assert.match(markdown, /## Recommended Candidate/);
  assert.match(markdown, /Bundle: `owner-env-rehearsal`/);
  assert.match(markdown, /## Recent Bundle Health/);
  assert.match(markdown, /\[INFRA\] 데이터베이스 연결/);
  assert.match(markdown, /Env: BUTO_DATABASE_URL/);
  assert.match(markdown, /docs\/submission\/bundles\/owner-env-rehearsal/);
});

test("listRecentSubmissionBundles reads manifest summaries in reverse chronological order", async () => {
  const bundlesDir = await mkdtemp(path.join(tmpdir(), "buto-bundles-"));
  const olderDir = path.join(bundlesDir, "older");
  const newerDir = path.join(bundlesDir, "newer");

  await mkdir(olderDir, { recursive: true });
  await mkdir(newerDir, { recursive: true });
  await writeFile(
    path.join(olderDir, "manifest.json"),
    JSON.stringify({
      bundleLabel: "older",
      generatedAt: "2026-03-10T00:00:00.000Z",
      readiness: {
        overallStatus: "WARN",
        blockers: 0,
        warnings: 1
      },
      documents: [{ fileName: "a.md" }],
      envFiles: [{ fileName: "a.env" }]
    }),
    "utf8"
  );
  await writeFile(
    path.join(newerDir, "manifest.json"),
    JSON.stringify({
      bundleLabel: "newer",
      generatedAt: "2026-03-10T01:00:00.000Z",
      readiness: {
        overallStatus: "READY",
        blockers: 0,
        warnings: 0
      },
      documents: [{ fileName: "a.md" }, { fileName: "b.md" }],
      envFiles: []
    }),
    "utf8"
  );

  const bundles = listRecentSubmissionBundles(bundlesDir, 2);

  assert.equal(bundles[0]?.bundleLabel, "newer");
  assert.equal(bundles[0]?.documentCount, 2);
  assert.equal(bundles[0]?.driftStatus, "IN_SYNC");
  assert.equal(bundles[1]?.bundleLabel, "older");
  assert.equal(bundles[1]?.envFileCount, 1);
});

test("submission bundle detail marks drift and missing files against current readiness", async () => {
  const bundlesDir = await mkdtemp(path.join(tmpdir(), "buto-bundle-detail-"));
  const bundleDir = path.join(bundlesDir, "candidate");

  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    path.join(bundleDir, "manifest.json"),
    JSON.stringify({
      bundleLabel: "candidate",
      generatedAt: "2026-03-10T01:00:00.000Z",
      readiness: {
        overallStatus: "WARN",
        blockers: 0,
        warnings: 1
      },
      documents: [],
      envFiles: []
    }),
    "utf8"
  );
  await writeFile(path.join(bundleDir, "README.md"), "# BUTO Submission Bundle\n", "utf8");

  const detail = readSubmissionBundleDetail(bundlesDir, "candidate", {
    overallStatus: "ACTION_REQUIRED",
    checkedAt: "2026-03-10T02:00:00.000Z",
    blockers: 2,
    warnings: 1,
    owners: [],
    checks: []
  });

  assert.ok(detail);
  assert.equal(detail?.integrityStatus, "INCOMPLETE");
  assert.equal(detail?.driftStatus, "STALE");
  assert.ok(detail?.missingFiles.includes("runtime-readiness-report.md"));
  assert.ok(detail?.driftReasons.some((reason) => reason.includes("overallStatus")));
});

test("recommendSubmissionBundle prefers complete and in-sync bundles", () => {
  const recommendation = recommendSubmissionBundle([
    {
      bundleLabel: "stale-one",
      generatedAt: "2026-03-10T00:00:00.000Z",
      overallStatus: "ACTION_REQUIRED",
      blockers: 2,
      warnings: 1,
      documentCount: 7,
      envFileCount: 4,
      integrityStatus: "COMPLETE",
      missingFiles: [],
      driftStatus: "STALE",
      driftReasons: ["blockers 1 -> 2"]
    },
    {
      bundleLabel: "good-one",
      generatedAt: "2026-03-10T01:00:00.000Z",
      overallStatus: "WARN",
      blockers: 0,
      warnings: 1,
      documentCount: 7,
      envFileCount: 4,
      integrityStatus: "COMPLETE",
      missingFiles: [],
      driftStatus: "IN_SYNC",
      driftReasons: []
    }
  ]);

  assert.equal(recommendation.recommendedBundleLabel, "good-one");
  assert.equal(recommendation.status, "ACTION_REQUIRED");
  assert.ok(recommendation.reasons.some((reason) => reason.includes("필수 제출 파일")));
});

test("buildReleaseSubmissionDecision fails closed when blockers remain", () => {
  const decision = buildReleaseSubmissionDecision({
    readiness: {
      overallStatus: "ACTION_REQUIRED",
      checkedAt: "2026-03-10T00:00:00.000Z",
      blockers: 2,
      warnings: 1,
      owners: [],
      checks: []
    },
    recommendation: {
      recommendedBundleLabel: "candidate",
      status: "ACTION_REQUIRED",
      reasons: ["필수 제출 파일이 모두 들어 있어요."]
    }
  });

  assert.equal(decision.decision, "BLOCKED");
  assert.ok(decision.reasons.some((reason) => reason.includes("blocker")));
});
