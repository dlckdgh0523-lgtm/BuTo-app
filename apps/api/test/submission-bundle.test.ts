import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { formatOwnerActionPlan, formatOwnerEnvHandoff, formatSingleOwnerEnvHandoff, formatSubmissionBundleIndex, writeSubmissionBundle } from "../src/modules/submission-bundle.ts";

test("submission bundle index lists readiness summary and included files", () => {
  const markdown = formatSubmissionBundleIndex({
    bundleLabel: "production-2026-03-10",
    environmentLabel: "production",
    generatedAt: "2026-03-10T12:00:00.000Z",
    readiness: {
      overallStatus: "ACTION_REQUIRED",
      blockers: 2,
      warnings: 1
    },
    documents: [
      {
        fileName: "app-registration-packet.md",
        title: "App registration packet",
        sourcePath: "/tmp/app-registration-packet.md"
      },
      {
        fileName: "runtime-readiness-report.md",
        title: "Runtime readiness markdown report",
        sourcePath: "/tmp/runtime-readiness-report.md"
      }
    ]
  });

  assert.match(markdown, /Bundle label: `production-2026-03-10`/);
  assert.match(markdown, /Runtime readiness: `ACTION_REQUIRED`/);
  assert.match(markdown, /app-registration-packet\.md/);
  assert.match(markdown, /Clear every blocker before submitting for launch review/);
});

test("submission bundle writer copies docs and emits manifest and readiness files", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "buto-submission-bundle-"));
  const docsDir = await mkdtemp(path.join(tmpdir(), "buto-submission-docs-"));
  const registrationPacket = path.join(docsDir, "app-registration-packet.md");
  const qaTemplate = path.join(docsDir, "launch-qa-report-template.md");
  const apiEnvExample = path.join(docsDir, "api.env.production.example");
  await writeFile(registrationPacket, "# Packet\n", "utf8");
  await writeFile(qaTemplate, "# QA\n", "utf8");
  await writeFile(apiEnvExample, "BUTO_DATABASE_URL=postgres://example\n", "utf8");

  const result = writeSubmissionBundle({
    outputDir,
    bundleLabel: "production-2026-03-10",
    environmentLabel: "production",
    generatedAt: "2026-03-10T12:00:00.000Z",
    readiness: {
      overallStatus: "WARN",
      checkedAt: "2026-03-10T12:00:00.000Z",
      blockers: 0,
      warnings: 1,
      owners: [
        {
          owner: "INFRA",
          blockers: 0,
          warnings: 1,
          passing: 0,
          total: 1
        }
      ],
      checks: [
        {
          key: "database",
          status: "WARN",
          title: "데이터베이스 연결",
          detail: "운영 DB 연결 문자열이 없어요.",
          owner: "INFRA",
          remediation: "DB 연결 문자열을 설정하세요.",
          envKeys: ["BUTO_DATABASE_URL"]
        }
      ]
    },
    documents: [
      {
        sourcePath: registrationPacket,
        title: "App registration packet"
      },
      {
        sourcePath: qaTemplate,
        title: "Launch QA report template"
      }
    ],
    envSources: [
      {
        sourcePath: apiEnvExample
      }
    ],
    releaseStatus: {
      checklistSections: [
        {
          title: "P0",
          checked: 2,
          unchecked: 3
        }
      ],
      recentBundles: ["staging-preflight"]
    }
  });

  const readme = await readFile(path.join(result.outputDir, "README.md"), "utf8");
  const manifest = await readFile(path.join(result.outputDir, "manifest.json"), "utf8");
  const readinessJson = await readFile(path.join(result.outputDir, "runtime-readiness-report.json"), "utf8");
  const ownerPlan = await readFile(path.join(result.outputDir, "owner-action-plan.md"), "utf8");
  const ownerEnvHandoff = await readFile(path.join(result.outputDir, "owner-env-handoff.md"), "utf8");
  const infraEnvFile = await readFile(path.join(result.outputDir, "infra-env.example"), "utf8");
  const releaseStatus = await readFile(path.join(result.outputDir, "release-status-snapshot.md"), "utf8");
  const copiedPacket = await readFile(path.join(result.outputDir, "app-registration-packet.md"), "utf8");

  assert.match(readme, /Warnings: `1`/);
  assert.match(readme, /Risk Ops and release owner must explicitly accept/);
  assert.match(manifest, /"bundleLabel": "production-2026-03-10"/);
  assert.match(manifest, /"fileName": "infra-env.example"/);
  assert.match(readinessJson, /"overallStatus": "WARN"/);
  assert.match(ownerPlan, /## Infrastructure/);
  assert.match(ownerPlan, /DB 연결 문자열을 설정하세요/);
  assert.match(ownerEnvHandoff, /## Infrastructure/);
  assert.match(ownerEnvHandoff, /BUTO_DATABASE_URL=postgres:\/\/example/);
  assert.match(infraEnvFile, /BUTO_DATABASE_URL=postgres:\/\/example/);
  assert.match(releaseStatus, /# BUTO Release Status Snapshot/);
  assert.match(releaseStatus, /## Recent Bundles/);
  assert.equal(copiedPacket, "# Packet\n");
});

test("owner action plan groups unresolved checks by owner", () => {
  const markdown = formatOwnerActionPlan({
    bundleLabel: "production-2026-03-10",
    environmentLabel: "production",
    readiness: {
      overallStatus: "ACTION_REQUIRED",
      checkedAt: "2026-03-10T12:00:00.000Z",
      blockers: 1,
      warnings: 1,
      owners: [
        {
          owner: "INFRA",
          blockers: 1,
          warnings: 0,
          passing: 0,
          total: 1
        },
        {
          owner: "BACKEND",
          blockers: 0,
          warnings: 1,
          passing: 0,
          total: 1
        }
      ],
      checks: [
        {
          key: "proof-storage-provider",
          status: "BLOCK",
          title: "증빙 스토리지 provider",
          detail: "로컬 provider를 사용 중이에요.",
          owner: "INFRA",
          remediation: "s3 provider로 전환하세요.",
          envKeys: ["BUTO_PROOF_STORAGE_PROVIDER", "BUTO_PROOF_S3_BUCKET"],
          references: ["docs/ops/proof-storage-s3-runbook.md"]
        },
        {
          key: "strict-runtime-flags",
          status: "WARN",
          title: "strict runtime 검사",
          detail: "strict env 검사가 꺼져 있어요.",
          owner: "BACKEND",
          remediation: "strict env를 켜세요."
        }
      ]
    }
  });

  assert.match(markdown, /## Infrastructure/);
  assert.match(markdown, /- Open blockers: `1`/);
  assert.match(markdown, /s3 provider로 전환하세요/);
  assert.match(markdown, /- Env keys: `BUTO_PROOF_STORAGE_PROVIDER`, `BUTO_PROOF_S3_BUCKET`/);
  assert.match(markdown, /## Backend/);
  assert.match(markdown, /strict env를 켜세요/);
});

test("owner env handoff lists unresolved env keys with example values when available", () => {
  const markdown = formatOwnerEnvHandoff({
    bundleLabel: "production-2026-03-10",
    environmentLabel: "production",
    envExampleMap: new Map([
      ["BUTO_ALLOWED_ORIGINS", "BUTO_ALLOWED_ORIGINS=https://apps-in-toss-sandbox.toss.im,https://apps-in-toss-live.toss.im"]
    ]),
    readiness: {
      overallStatus: "ACTION_REQUIRED",
      checkedAt: "2026-03-10T12:00:00.000Z",
      blockers: 1,
      warnings: 0,
      owners: [
        {
          owner: "BACKEND",
          blockers: 1,
          warnings: 0,
          passing: 0,
          total: 1
        }
      ],
      checks: [
        {
          key: "cors-origins",
          status: "BLOCK",
          title: "허용 origin 목록",
          detail: "placeholder origin이 남아 있어요.",
          owner: "BACKEND",
          remediation: "placeholder를 제거하세요.",
          envKeys: ["BUTO_ALLOWED_ORIGINS"]
        }
      ]
    }
  });

  assert.match(markdown, /## Backend/);
  assert.match(markdown, /BUTO_ALLOWED_ORIGINS=https:\/\/apps-in-toss-sandbox\.toss\.im,https:\/\/apps-in-toss-live\.toss\.im/);
});

test("single owner env handoff renders only the requested owner section", () => {
  const markdown = formatSingleOwnerEnvHandoff({
    bundleLabel: "production-2026-03-10",
    environmentLabel: "production",
    owner: "SECURITY",
    envExampleMap: new Map([
      ["TOSS_UNLINK_BASIC_USER", "TOSS_UNLINK_BASIC_USER=replace-me"],
      ["TOSS_UNLINK_BASIC_PASSWORD", "TOSS_UNLINK_BASIC_PASSWORD=replace-me-too"]
    ]),
    readiness: {
      overallStatus: "ACTION_REQUIRED",
      checkedAt: "2026-03-10T12:00:00.000Z",
      blockers: 2,
      warnings: 0,
      owners: [
        {
          owner: "SECURITY",
          blockers: 2,
          warnings: 0,
          passing: 0,
          total: 1
        },
        {
          owner: "INFRA",
          blockers: 1,
          warnings: 0,
          passing: 0,
          total: 1
        }
      ],
      checks: [
        {
          key: "unlink-basic-auth",
          status: "BLOCK",
          title: "unlink 콜백 인증",
          detail: "placeholder 값이에요.",
          owner: "SECURITY",
          remediation: "운영값을 넣으세요.",
          envKeys: ["TOSS_UNLINK_BASIC_USER", "TOSS_UNLINK_BASIC_PASSWORD"]
        },
        {
          key: "database",
          status: "BLOCK",
          title: "데이터베이스 연결",
          detail: "DB가 없어요.",
          owner: "INFRA",
          remediation: "DB를 넣으세요.",
          envKeys: ["BUTO_DATABASE_URL"]
        }
      ]
    }
  });

  assert.match(markdown, /## Security/);
  assert.doesNotMatch(markdown, /## Infrastructure/);
  assert.match(markdown, /TOSS_UNLINK_BASIC_USER=replace-me/);
});
