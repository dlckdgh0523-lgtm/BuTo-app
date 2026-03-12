import assert from "node:assert/strict";
import test from "node:test";

import { formatRuntimeReadinessMarkdown } from "../src/modules/runtime-readiness-report.ts";

test("runtime readiness markdown formatter includes summary and checks", () => {
  const markdown = formatRuntimeReadinessMarkdown(
    {
      overallStatus: "ACTION_REQUIRED",
      checkedAt: "2026-03-10T12:00:00.000Z",
      blockers: 2,
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
          key: "database",
          status: "BLOCK",
          title: "데이터베이스 연결",
          detail: "운영 DB 연결 문자열이 없어요.",
          owner: "INFRA",
          remediation: "운영 DB 연결 문자열을 설정하세요.",
          envKeys: ["BUTO_DATABASE_URL"],
          references: ["apps/api/.env.production.example"]
        },
        {
          key: "strict-runtime-flags",
          status: "WARN",
          title: "strict runtime 검사",
          detail: "strict runtime 또는 database env 검사가 꺼져 있어요.",
          owner: "BACKEND",
          remediation: "strict runtime 검사를 켜세요."
        }
      ]
    },
    {
      environmentLabel: "staging"
    }
  );

  assert.match(markdown, /# BUTO Runtime Readiness Report/);
  assert.match(markdown, /Environment: `staging`/);
  assert.match(markdown, /Overall status: `ACTION REQUIRED`/);
  assert.match(markdown, /## Owner Summary/);
  assert.match(markdown, /- Infrastructure: BLOCK 1 \/ WARN 0 \/ PASS 0 \/ TOTAL 1/);
  assert.match(markdown, /## Cutover Order/);
  assert.match(markdown, /1\. INFRA/);
  assert.match(markdown, /## Checks/);
  assert.match(markdown, /### 데이터베이스 연결/);
  assert.match(markdown, /- Status: `BLOCK`/);
  assert.match(markdown, /- Owner: `INFRA`/);
  assert.match(markdown, /- Next action: 운영 DB 연결 문자열을 설정하세요\./);
  assert.match(markdown, /- Env keys: `BUTO_DATABASE_URL`/);
  assert.match(markdown, /Launch should stay blocked/);
});
