# Runtime Workers

## Idle Timeout Sweep

`pnpm idle-timeout:sweep`

- 목적: 개인 대화 무응답 20분 자동 파기를 주기적으로 평가합니다.
- 적용 범위: `MATCHED`, `RUNNER_EN_ROUTE`
- 제외 범위: `RUNNER_ARRIVED` 이후, `PICKED_UP` 이후, 분쟁 상태
- 결과: 거래가 불발로 종료되면 `CANCELLED`, `PAYMENT_REFUNDED`, 인앱 알림, 감사 로그를 함께 남깁니다.

권장 cron:

```cron
*/2 * * * * cd /srv/buto && pnpm idle-timeout:sweep
```

## Outbox Drain

`pnpm outbox:drain`

- 목적: 상태 변경 이벤트를 인앱 알림으로 투영합니다.
- 선행 조건: DB 마이그레이션 완료, `BUTO_DATABASE_URL` 설정

권장 cron:

```cron
* * * * * cd /srv/buto && pnpm outbox:drain
```

## Push Dispatch

`pnpm push:dispatch`

- 목적: unread notification을 push provider로 전달합니다.
- 기본 provider: `log`
- webhook provider 사용 시 `BUTO_PUSH_WEBHOOK_URL`, `BUTO_PUSH_WEBHOOK_SECRET` 필요

권장 cron:

```cron
* * * * * cd /srv/buto && pnpm push:dispatch
```

## Startup Order

1. `pnpm db:migrate`
2. `pnpm runtime:readiness`
3. API server boot
4. `pnpm outbox:drain`
5. `pnpm push:dispatch`
6. `pnpm idle-timeout:sweep`

## Runtime Readiness

`pnpm runtime:readiness`

- 목적: 출시 blocker와 warning을 배포 셸이나 CI에서 바로 점검합니다.
- 종료 코드:
  - `0`: blocker 없음
  - `1`: blocker 있음
- 옵션:
  - `pnpm runtime:readiness -- --strict-warn`
  - warning도 실패로 취급하고 싶을 때 사용합니다.

`pnpm runtime:readiness:report`

- 목적: 심사 제출물이나 운영 검토 문서에 첨부할 Markdown 리포트를 생성합니다.
- 종료 코드:
  - `0`: 현재 blocker가 있어도 리포트 파일은 생성합니다.
- 산출물:
  - `docs/submission/runtime-readiness-report.md`

## Safety Notes

- `idle-timeout:sweep`는 도착 알림 이후에는 거래를 자동 파기하지 않습니다.
- 픽업 이후 이슈는 자동 취소 대신 `DISPUTED` 또는 운영 검토로 넘겨야 합니다.
- worker 실패는 재시도 가능해야 하므로, 운영에서는 stderr/exit code 모니터링을 붙이는 것이 맞습니다.
