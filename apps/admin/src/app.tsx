import React from "react";

import { StatusBadge, butoTheme } from "../../../packages/ui/src/index.ts";

const sections = [
  {
    title: "리스크 검수 큐",
    tone: "warning" as const,
    items: ["고위험 키워드 포함 의뢰", "야간 고액 검수 대기", "차단 문구 재시도 사용자"]
  },
  {
    title: "분쟁 센터",
    tone: "danger" as const,
    items: ["PICKED_UP 이후 채팅 차단 건", "허위 완료 신고", "사진 증빙 불일치"]
  },
  {
    title: "긴급 이벤트",
    tone: "danger" as const,
    items: ["SOS 즉시 대응", "위협/성희롱 신고", "최근 위치 봉인 기록"]
  },
  {
    title: "서류 승인",
    tone: "brand" as const,
    items: ["차량등록증", "사업자등록증", "보험/적재 가능 정보"]
  },
  {
    title: "정산 보류/해제",
    tone: "warning" as const,
    items: ["일배치 RELEASE_READY 검토", "차량 의뢰 수동 확인", "신고 건 지급 보류"]
  },
  {
    title: "정책 사전 관리",
    tone: "default" as const,
    items: ["금칙어", "은어/변형어", "채팅 moderation override"]
  }
];

export function AdminConsole() {
  return (
    <div style={shellStyle}>
      <header style={heroStyle}>
        <div>
          <StatusBadge label="Risk Ops Console" tone="brand" />
          <h1 style={{ margin: "18px 0 10px", fontSize: 38, color: "#082f49" }}>부토 운영 콘솔</h1>
          <p style={{ margin: 0, lineHeight: 1.7, color: "#334155", maxWidth: 760 }}>
            검수자는 위험 의뢰, 채팅 moderation, 긴급 이벤트, 정산 보류, 서류 승인 액션을 한 화면에서 추적하고 감사 로그를 남깁니다.
          </p>
        </div>
      </header>

      <main style={gridStyle}>
        {sections.map((section) => (
          <section key={section.title} style={panelStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
              <h2 style={{ margin: 0, color: butoTheme.colors.ink }}>{section.title}</h2>
              <StatusBadge
                label={section.title.includes("긴급") ? "즉시 대응" : section.title.includes("정산") ? "보류 기준 적용" : "운영 정책"}
                tone={section.tone}
              />
            </div>
            <ul style={listStyle}>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div style={footerCardStyle}>
              <strong>감사 로그</strong>
              <p style={{ margin: "6px 0 0", color: "#57534e" }}>모든 운영 액션은 2차 검토 가능 상태와 함께 저장됩니다.</p>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: 28,
  background: "radial-gradient(circle at top left, #e0f2fe 0%, #fff7ed 45%, #fffbeb 100%)",
  fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
};

const heroStyle: React.CSSProperties = {
  marginBottom: 24,
  padding: 28,
  borderRadius: 32,
  background: "#ffffff",
  border: `1px solid ${butoTheme.colors.line}`,
  boxShadow: butoTheme.shadow
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 20
};

const panelStyle: React.CSSProperties = {
  background: "#fffefc",
  borderRadius: 28,
  padding: 22,
  border: `1px solid ${butoTheme.colors.line}`,
  display: "grid",
  gap: 16
};

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: "#334155",
  lineHeight: 1.7
};

const footerCardStyle: React.CSSProperties = {
  background: "#f8fafc",
  borderRadius: 20,
  padding: 14
};
