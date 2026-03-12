import { existsSync } from "node:fs";

import { ok, type RuntimeReadinessCheck, type RuntimeReadinessSummary } from "../../../../packages/contracts/src/index.ts";

import { type ApiRuntimeConfig, validateApiRuntimeConfig, validateDatabaseEnv, validateTossAuthEnv } from "../env.ts";

const tossAuthEnvKeys = [
  "TOSS_LOGIN_TOKEN_URL",
  "TOSS_LOGIN_ME_URL",
  "TOSS_PARTNER_CLIENT_ID",
  "TOSS_PARTNER_CLIENT_SECRET",
  "TOSS_PARTNER_CERT_PATH",
  "TOSS_PARTNER_KEY_PATH",
  "TOSS_PARTNER_CA_PATH",
  "TOSS_CERT_TOKEN_URL",
  "TOSS_CERT_REQUEST_URL",
  "TOSS_CERT_STATUS_URL",
  "TOSS_CERT_RESULT_URL",
  "TOSS_CERT_CLIENT_ID",
  "TOSS_CERT_CLIENT_SECRET",
  "TOSS_CERT_REQUEST_URL_SCHEME"
] as const;

const tossPayEnvKeys = [
  "TOSS_PAY_BASE_URL",
  "TOSS_PAY_CLIENT_ID",
  "TOSS_PAY_CLIENT_SECRET",
  "TOSS_PAY_MERCHANT_ID",
  "TOSS_PAY_TEST_MODE"
] as const;

function includesPlaceholder(value: string | undefined) {
  if (!value) {
    return true;
  }

  return (
    value.includes(".invalid") ||
    value.includes("placeholder") ||
    value.includes("localhost") ||
    value.includes("127.0.0.1")
  );
}

function createCheck(input: RuntimeReadinessCheck) {
  return input;
}

export class RuntimeReadinessService {
  constructor(
    private readonly runtimeConfig: ApiRuntimeConfig,
    private readonly env = process.env
  ) {}

  evaluate() {
    const runtimeValidation = validateApiRuntimeConfig(this.runtimeConfig);
    const databaseValidation = validateDatabaseEnv(this.runtimeConfig);
    const tossEnvValidation = validateTossAuthEnv(this.env);
    const checks: RuntimeReadinessCheck[] = [];
    const storageIssues = runtimeValidation.issues.filter((issue) => issue.startsWith("BUTO_PROOF_S3_"));

    checks.push(createCheck({
      key: "runtime-secrets",
      status: runtimeValidation.issues.some((issue) => ["BUTO_AUTH_TOKEN_SECRET", "BUTO_INTERNAL_SYSTEM_KEY"].includes(issue)) ? "BLOCK" : "PASS",
      title: "런타임 시크릿",
      detail: runtimeValidation.issues.some((issue) => ["BUTO_AUTH_TOKEN_SECRET", "BUTO_INTERNAL_SYSTEM_KEY"].includes(issue))
        ? "기본 인증 시크릿 또는 내부 시스템 키가 아직 개발용 기본값이에요."
        : "인증 시크릿과 내부 시스템 키가 운영값으로 설정돼 있어요.",
      owner: "SECURITY",
      remediation: "운영용 랜덤 시크릿을 발급해 API 런타임 env에 주입하고, 기본값 부팅을 금지하세요.",
      envKeys: ["BUTO_AUTH_TOKEN_SECRET", "BUTO_INTERNAL_SYSTEM_KEY"],
      references: ["apps/api/.env.production.example", "docs/runtime-env-placeholders.md"]
    }));

    checks.push(createCheck({
      key: "database",
      status: this.runtimeConfig.databaseUrl ? "PASS" : databaseValidation.ok ? "WARN" : "BLOCK",
      title: "데이터베이스 연결",
      detail: this.runtimeConfig.databaseUrl
        ? "운영 DB 연결 문자열이 설정돼 있어요."
        : "운영 DB 연결 문자열이 없어요. 지금 상태는 재시작/장애 복구에 취약해요.",
      owner: "INFRA",
      remediation: "Postgres 연결 문자열을 설정하고 `pnpm db:migrate` 이후 worker와 API를 같은 DB에 붙이세요.",
      envKeys: ["BUTO_DATABASE_URL"],
      references: ["apps/api/.env.production.example", "docs/runtime-workers.md"]
    }));

    const certPath = this.env.TOSS_PARTNER_CERT_PATH;
    const keyPath = this.env.TOSS_PARTNER_KEY_PATH;
    checks.push(createCheck({
      key: "mtls-certificates",
      status: !certPath || !keyPath || !existsSync(certPath) || !existsSync(keyPath) ? "BLOCK" : "PASS",
      title: "mTLS 인증서",
      detail: !certPath || !keyPath
        ? "TOSS_PARTNER_CERT_PATH 또는 TOSS_PARTNER_KEY_PATH가 비어 있어요."
        : !existsSync(certPath) || !existsSync(keyPath)
          ? "설정된 mTLS 인증서 또는 키 파일을 서버에서 찾을 수 없어요."
          : "mTLS 인증서와 키 파일을 서버에서 읽을 수 있어요.",
      owner: "INFRA",
      remediation: "파트너 인증서와 키를 서버에 마운트하고 파일 경로를 env에 설정한 뒤 readiness를 다시 실행하세요.",
      envKeys: ["TOSS_PARTNER_CERT_PATH", "TOSS_PARTNER_KEY_PATH", "TOSS_PARTNER_CA_PATH"],
      references: ["apps/api/.env.production.example", "docs/apps-in-toss-release-checklist.md"]
    }));

    const authMissing = tossEnvValidation.missing.filter((key) => key.startsWith("TOSS_LOGIN_") || key.startsWith("TOSS_CERT_") || key.startsWith("TOSS_PARTNER_"));
    checks.push(createCheck({
      key: "toss-auth-env",
      status: authMissing.length > 0 ? "BLOCK" : "PASS",
      title: "토스 로그인 / 인증 설정",
      detail: authMissing.length > 0 ? `누락된 인증 env: ${authMissing.join(", ")}` : "토스 로그인과 원터치 인증 env가 채워져 있어요."
      ,
      owner: "PARTNERSHIP",
      remediation: "토스 로그인/인증 운영 계약값과 endpoint를 env에 넣고, callback과 결과조회 경로를 샌드박스/운영으로 검증하세요.",
      envKeys: authMissing.length > 0 ? authMissing : [...tossAuthEnvKeys],
      references: ["apps/api/.env.production.example", "docs/apps-in-toss-release-checklist.md"]
    }));

    const payMissing = tossEnvValidation.missing.filter((key) => key.startsWith("TOSS_PAY_"));
    checks.push(createCheck({
      key: "toss-pay-env",
      status: payMissing.length > 0 ? "BLOCK" : this.runtimeConfig.tossPayTestMode ? "WARN" : "PASS",
      title: "토스페이 설정",
      detail: payMissing.length > 0
        ? `누락된 결제 env: ${payMissing.join(", ")}`
        : this.runtimeConfig.tossPayTestMode
          ? "결제 env는 있지만 아직 test mode가 켜져 있어요."
          : "토스페이 운영 설정이 준비돼 있어요.",
      owner: "PARTNERSHIP",
      remediation: "토스페이 운영 merchant/client 자격증명과 base URL을 주입하고 test mode를 끈 뒤 승인/환불 QA를 다시 확인하세요.",
      envKeys: payMissing.length > 0 ? [...payMissing, "TOSS_PAY_TEST_MODE"] : [...tossPayEnvKeys],
      references: ["apps/api/.env.production.example", "docs/apps-in-toss-release-checklist.md"]
    }));

    checks.push(createCheck({
      key: "proof-storage-provider",
      status:
        this.runtimeConfig.proofStorageProvider === "s3"
          ? storageIssues.length > 0
            ? "BLOCK"
            : "PASS"
          : "BLOCK",
      title: "증빙 스토리지 provider",
      detail:
        this.runtimeConfig.proofStorageProvider === "s3"
          ? storageIssues.length > 0
            ? `object storage provider 설정이 누락됐어요: ${storageIssues.join(", ")}`
            : "증빙 업로드가 object storage provider를 사용하도록 설정돼 있어요. 출시 전에는 실제 bucket, lifecycle, 접근정책을 확인해야 해요."
          : "현재 증빙은 로컬 임시 저장 provider를 사용해요. 운영에서는 object storage와 lifecycle 정책이 필요해요.",
      owner: "INFRA",
      remediation: "증빙 스토리지를 `s3`로 전환하고 bucket, lifecycle, 접근정책, 검증 경로를 운영 설정으로 마무리하세요.",
      envKeys:
        this.runtimeConfig.proofStorageProvider === "s3"
          ? ["BUTO_PROOF_STORAGE_PROVIDER", ...storageIssues]
          : [
              "BUTO_PROOF_STORAGE_PROVIDER",
              "BUTO_PROOF_S3_BUCKET",
              "BUTO_PROOF_S3_REGION",
              "BUTO_PROOF_S3_ENDPOINT",
              "BUTO_PROOF_S3_ACCESS_KEY_ID",
              "BUTO_PROOF_S3_SECRET_ACCESS_KEY"
            ],
      references: ["apps/api/.env.production.example", "docs/ops/proof-storage-s3-runbook.md"]
    }));

    checks.push(createCheck({
      key: "proof-urls",
      status:
        this.runtimeConfig.proofStorageProvider === "s3"
          ? includesPlaceholder(this.runtimeConfig.proofPublicBaseUrl) || includesPlaceholder(this.runtimeConfig.proofS3Endpoint)
            ? "BLOCK"
            : "PASS"
          : includesPlaceholder(this.runtimeConfig.uploadPublicBaseUrl) || includesPlaceholder(this.runtimeConfig.proofPublicBaseUrl)
            ? "BLOCK"
            : "PASS",
      title: "증빙 업로드 / 공개 URL",
      detail:
        this.runtimeConfig.proofStorageProvider === "s3"
          ? includesPlaceholder(this.runtimeConfig.proofPublicBaseUrl) || includesPlaceholder(this.runtimeConfig.proofS3Endpoint)
            ? "S3 endpoint 또는 CDN base URL이 아직 localhost/placeholder 값이에요."
            : "S3 endpoint와 공개 URL이 운영 도메인으로 설정돼 있어요."
          : includesPlaceholder(this.runtimeConfig.uploadPublicBaseUrl) || includesPlaceholder(this.runtimeConfig.proofPublicBaseUrl)
            ? "업로드 또는 CDN base URL이 아직 localhost/placeholder 값이에요."
            : "업로드와 공개 URL이 운영 도메인으로 설정돼 있어요.",
      owner: "INFRA",
      remediation: "운영 CDN 또는 object storage 공개 URL을 placeholder 대신 실제 도메인으로 교체하세요.",
      envKeys:
        this.runtimeConfig.proofStorageProvider === "s3"
          ? ["BUTO_PROOF_S3_ENDPOINT", "BUTO_PROOF_PUBLIC_BASE_URL"]
          : ["BUTO_UPLOAD_PUBLIC_BASE_URL", "BUTO_PROOF_PUBLIC_BASE_URL"],
      references: ["apps/api/.env.production.example", "docs/runtime-env-placeholders.md"]
    }));

    checks.push(createCheck({
      key: "cors-origins",
      status: this.runtimeConfig.allowedOrigins.some((origin) => includesPlaceholder(origin)) ? "BLOCK" : "PASS",
      title: "허용 origin 목록",
      detail: this.runtimeConfig.allowedOrigins.some((origin) => includesPlaceholder(origin))
        ? `placeholder 또는 localhost origin이 남아 있어요: ${this.runtimeConfig.allowedOrigins.filter((origin) => includesPlaceholder(origin)).join(", ")}`
        : "허용 origin 목록이 운영 도메인으로 설정돼 있어요.",
      owner: "BACKEND",
      remediation: "Apps-in-Toss sandbox/live origin과 실제 miniapp 도메인만 허용 목록에 남기고 placeholder를 제거하세요.",
      envKeys: ["BUTO_ALLOWED_ORIGINS"],
      references: ["apps/api/.env.production.example", "docs/apps-in-toss-release-checklist.md"]
    }));

    checks.push(createCheck({
      key: "unlink-basic-auth",
      status: includesPlaceholder(this.runtimeConfig.tossUnlinkBasicUser) || includesPlaceholder(this.runtimeConfig.tossUnlinkBasicPassword) ? "BLOCK" : "PASS",
      title: "unlink 콜백 인증",
      detail: includesPlaceholder(this.runtimeConfig.tossUnlinkBasicUser) || includesPlaceholder(this.runtimeConfig.tossUnlinkBasicPassword)
        ? "unlink callback Basic Auth가 아직 placeholder 값이에요."
        : "unlink callback Basic Auth가 운영값으로 설정돼 있어요.",
      owner: "SECURITY",
      remediation: "콘솔 unlink callback 설정과 동일한 Basic Auth 값을 운영 env에 넣고, 연결 끊기 콜백을 실서버에서 검증하세요.",
      envKeys: ["TOSS_UNLINK_BASIC_USER", "TOSS_UNLINK_BASIC_PASSWORD"],
      references: ["apps/api/.env.production.example", "docs/apps-in-toss-release-checklist.md"]
    }));

    checks.push(createCheck({
      key: "strict-runtime-flags",
      status: this.runtimeConfig.strictRuntimeEnv && this.runtimeConfig.strictDatabaseEnv ? "PASS" : "WARN",
      title: "strict runtime 검사",
      detail: this.runtimeConfig.strictRuntimeEnv && this.runtimeConfig.strictDatabaseEnv
        ? "strict runtime / database env 검사가 켜져 있어요."
        : "strict runtime 또는 database env 검사가 꺼져 있어요.",
      owner: "BACKEND",
      remediation: "운영 부팅에서 strict runtime/database env 검사를 켜고 기본값 부팅을 막으세요.",
      envKeys: ["BUTO_STRICT_RUNTIME_ENV", "BUTO_STRICT_DATABASE_ENV"],
      references: ["apps/api/.env.production.example", "docs/runtime-workers.md"]
    }));

    const blockers = checks.filter((check) => check.status === "BLOCK").length;
    const warnings = checks.filter((check) => check.status === "WARN").length;
    const ownerOrder: RuntimeReadinessCheck["owner"][] = ["INFRA", "SECURITY", "PARTNERSHIP", "BACKEND", "RISK_OPS"];
    const owners = ownerOrder
      .map((owner) => {
        const items = checks.filter((check) => check.owner === owner);
        if (items.length === 0) {
          return null;
        }

        return {
          owner,
          blockers: items.filter((check) => check.status === "BLOCK").length,
          warnings: items.filter((check) => check.status === "WARN").length,
          passing: items.filter((check) => check.status === "PASS").length,
          total: items.length
        };
      })
      .filter((owner): owner is NonNullable<typeof owner> => owner !== null);

    return ok<RuntimeReadinessSummary>({
      overallStatus: blockers > 0 ? "ACTION_REQUIRED" : warnings > 0 ? "WARN" : "READY",
      checkedAt: new Date().toISOString(),
      blockers,
      warnings,
      checks,
      owners
    });
  }
}
