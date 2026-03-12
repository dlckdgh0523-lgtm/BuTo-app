import React from "react";

import { StatusBadge, butoTheme } from "../../../../packages/ui/src/index.ts";
import { TDSButton } from "./lightweight-primitives.tsx";

export function ReviewsCommunityScreen() {
  return (
    <section style={gridTwoColumnStyle}>
      <Panel title="거래 후기" subtitle="완료된 거래 당사자만 리뷰를 남길 수 있어요.">
        <div style={{ display: "grid", gap: 12 }}>
          <article style={rowCardStyle}>
            <div>
              <strong>별점 5.0</strong>
              <p style={{ margin: "6px 0 0", color: "#57534e" }}>위치 안내가 명확하고 사진 인증이 잘 보여서 안심됐어요.</p>
            </div>
            <StatusBadge label="최근 90일 가중" tone="brand" />
          </article>
        </div>
      </Panel>
      <Panel title="제한적 커뮤니티" subtitle="자유 게시판이 아니라 후기 중심 게시판만 엽니다.">
        <ul style={listStyle}>
          <li>전화번호, 계좌, 상세 주소, 실명은 서버에서 자동 마스킹해요.</li>
          <li>텍스트와 단일 이미지 첨부만 허용해요.</li>
          <li>신고가 들어온 게시물은 운영 검토 전까지 비공개 처리할 수 있어요.</li>
        </ul>
      </Panel>
    </section>
  );
}

export function ProfileScreen(props: {
  session: {
    user: {
      nickname: string;
      adultVerified: boolean;
    };
    tossAuthValidUntil?: string;
  };
  sdkState: {
    appVersion?: string;
  };
  withdrawing: boolean;
  onWithdraw(): void;
}) {
  return (
    <Panel title="내 정보" subtitle="토스 연동 상태, 안전 상태, 탈퇴 가능 여부를 한 화면에서 확인해요.">
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="닉네임" value={props.session.user.nickname} />
        <Field label="성인 인증" value={props.session.user.adultVerified ? "완료" : "필요"} />
        <Field label="안전수칙 확인" value="로그인 후 재확인 완료" />
        <Field label="토스 앱 버전" value={props.sdkState.appVersion ?? "확인 불가"} />
        <Field label="토스 인증 유효" value={props.session.tossAuthValidUntil ? formatDateTime(props.session.tossAuthValidUntil) : "민감 행위 전 재인증 필요"} />
        <div style={featureCardStyle}>
          <strong>서비스 운영 원칙</strong>
          <p style={featureBodyStyle}>
            연결 끊기, 제재, 탈퇴는 계정 상태와 이력으로 관리하고, 주요 거래 기록과 제재 이력은 임의 삭제하지 않아요.
          </p>
          <p style={{ ...featureBodyStyle, marginTop: 10 }}>
            거래 불발 환불은 픽업 전 취소에만 적용하고, 환불 사유는 서버에서 정규화해 클라이언트 결제수단으로 접수해요.
          </p>
        </div>
        <TDSButton color="danger" variant="weak" size="large" loading={props.withdrawing} onClick={props.onWithdraw}>
          회원 탈퇴
        </TDSButton>
      </div>
    </Panel>
  );
}

function Panel(props: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section style={panelStyle}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 24, color: butoTheme.colors.ink }}>{props.title}</h2>
        <p style={{ margin: "8px 0 0", color: "#57534e", lineHeight: 1.6 }}>{props.subtitle}</p>
      </div>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; value: string; multiline?: boolean }) {
  return (
    <label style={{ display: "grid", gap: 8 }}>
      <span style={{ fontWeight: 700, color: butoTheme.colors.ink }}>{props.label}</span>
      <div style={{ ...cardStyle, minHeight: props.multiline ? 120 : "auto" }}>{props.value}</div>
    </label>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

const panelStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 28,
  padding: 24,
  border: `1px solid ${butoTheme.colors.line}`,
  boxShadow: butoTheme.shadow
};

const cardStyle: React.CSSProperties = {
  background: "#fbfcfe",
  borderRadius: 24,
  padding: 16,
  border: `1px solid ${butoTheme.colors.line}`
};

const rowCardStyle: React.CSSProperties = {
  ...cardStyle,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16
};

const gridTwoColumnStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 20
};

const listStyle: React.CSSProperties = {
  margin: 0,
  color: "#4e5968",
  display: "grid",
  gap: 10,
  lineHeight: 1.6
};

const featureCardStyle: React.CSSProperties = {
  ...cardStyle,
  background: "#f9fbff"
};

const featureBodyStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#4e5968",
  lineHeight: 1.7
};
