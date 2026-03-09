import React, { useState } from "react";

import { productConfig } from "../../../packages/config/src/index.ts";
import { SafetyCard, StatusBadge, butoTheme } from "../../../packages/ui/src/index.ts";

const mockSession = {
  nickname: "서초의뢰자",
  adultVerified: true,
  safetyAcknowledged: false,
  faceAuthValid: false
};

type TabKey = "home" | "request" | "nearby" | "active" | "reviews" | "profile";

export function MiniApp() {
  const [tab, setTab] = useState<TabKey>("home");
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(mockSession.safetyAcknowledged);
  const [faceAuthValid, setFaceAuthValid] = useState(mockSession.faceAuthValid);

  if (!safetyAcknowledged) {
    return <SafetyAcknowledgementScreen onAcknowledge={() => setSafetyAcknowledged(true)} />;
  }

  return (
    <div style={shellStyle}>
      <header style={heroStyle}>
        <div>
          <StatusBadge label="성인 인증 완료" tone="brand" />
          <h1 style={{ margin: "16px 0 8px", fontSize: 36, color: "#f8fafc" }}>부토</h1>
          <p style={{ margin: 0, color: "#d1fae5", maxWidth: 520 }}>
            가까운 곳의 사람과 심부름을 안전하게 연결하는 위치기반 심부름 콜 미니앱
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <StatusBadge label={faceAuthValid ? "얼굴 인증 유효" : "얼굴 인증 필요"} tone={faceAuthValid ? "brand" : "warning"} />
          <StatusBadge label={`${productConfig.locationLogIntervalMinutes}분 위치기록`} tone="default" />
        </div>
      </header>

      <nav style={tabStyle}>
        {[
          ["home", "홈"],
          ["request", "심부름 요청"],
          ["nearby", "근처 의뢰"],
          ["active", "진행중 의뢰"],
          ["reviews", "후기/커뮤니티"],
          ["profile", "내 정보"]
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key as TabKey)}
            style={{
              ...tabButtonStyle,
              background: tab === key ? butoTheme.colors.brand : "#ffffff"
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <main style={{ display: "grid", gap: 20 }}>
        {tab === "home" && <HomeScreen />}
        {tab === "request" && <CreateJobScreen faceAuthValid={faceAuthValid} onStartFaceAuth={() => setFaceAuthValid(true)} />}
        {tab === "nearby" && <NearbyJobsScreen />}
        {tab === "active" && <ActiveJobScreen />}
        {tab === "reviews" && <ReviewsCommunityScreen />}
        {tab === "profile" && <ProfileScreen />}
      </main>
    </div>
  );
}

function SafetyAcknowledgementScreen(props: { onAcknowledge(): void }) {
  return (
    <div style={shellStyle}>
      <section style={safetyScreenStyle}>
        <div>
          <StatusBadge label="안전수칙 필수" tone="warning" />
          <h1 style={{ fontSize: 40, margin: "18px 0 10px", color: butoTheme.colors.ink }}>안전하게 이용해주세요</h1>
          <p style={{ fontSize: 18, lineHeight: 1.6, margin: 0, color: "#57534e" }}>
            부토는 실제 사람을 만나고 물건을 전달하는 서비스예요. 아래 수칙을 꼭 확인한 뒤 이용해주세요.
          </p>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <SafetyCard title="개인정보를 먼저 지켜주세요" body="집 주소, 상세 동호수, 공동현관 비밀번호, 계좌 비밀번호, 신분증 사진은 채팅으로 보내지 마세요." />
          <SafetyCard title="수상하면 바로 멈춰주세요" body="현금 전달, 통장/카드/OTP 전달, 술·담배·약 전달 요청은 바로 중단하고 신고해 주세요." />
          <SafetyCard title="불안하면 긴급 버튼을 사용하세요" body="위협, 강요, 성희롱, 목적지 변경 강요가 있으면 진행을 멈추고 긴급 버튼을 눌러주세요." />
          <SafetyCard title="채팅은 모두 기록돼요" body="불법·협박·부적절 대화가 확인되면 의뢰가 중단되고 계정이 제한될 수 있어요." />
        </div>
        <button style={primaryButtonStyle} onClick={props.onAcknowledge}>
          확인하고 시작하기
        </button>
      </section>
    </div>
  );
}

function HomeScreen() {
  return (
    <section style={gridTwoColumnStyle}>
      <Panel title="빠른 시작" subtitle="앱인토스 등록 기능 3개를 홈에서 바로 진입합니다.">
        <div style={{ display: "grid", gap: 12 }}>
          <QuickAction title="심부름 요청하기" body="얼굴 인증 후 결제 승인과 함께 의뢰를 생성해요." />
          <QuickAction title="근처 의뢰 보기" body="부르미가 조건에 맞는 의뢰만 빠르게 볼 수 있어요." />
          <QuickAction title="내 진행중 의뢰" body="상태 단계, 채팅, 사진 증빙, 긴급 신고를 한 곳에서 관리해요." />
        </div>
      </Panel>
      <Panel title="운영 원칙" subtitle="매칭 속도보다 안전과 증빙을 우선합니다.">
        <ul style={listStyle}>
          <li>불법/민감 키워드는 게시 전에 차단하거나 검수 큐로 보내요.</li>
          <li>결제는 held 상태로 보관하고 분쟁/신고가 있으면 자동 지급하지 않아요.</li>
          <li>위치 로그는 활성 의뢰 중에만 저장하고 완료 후 보관 범위를 줄여요.</li>
        </ul>
      </Panel>
    </section>
  );
}

function CreateJobScreen(props: { faceAuthValid: boolean; onStartFaceAuth(): void }) {
  return (
    <section style={gridTwoColumnStyle}>
      <Panel title="심부름 요청하기" subtitle="저위험 생활 심부름만 등록할 수 있어요.">
        <div style={{ display: "grid", gap: 16 }}>
          <Field label="제목" value="장보기 전달 부탁드려요" />
          <Field label="설명" value="마트 생활용품을 집 앞까지 전달해주세요." multiline />
          <Field label="출발지" value="서울 서초구 서초동" />
          <Field label="도착지" value="서울 강남구 역삼동" />
          <Field label="요청 금액" value="18,000원" />
          <div style={cardStyle}>
            <StatusBadge label={props.faceAuthValid ? "토스 얼굴 인증 완료" : "토스 얼굴 인증 필요"} tone={props.faceAuthValid ? "brand" : "warning"} />
            <p style={{ margin: "12px 0 0", color: "#57534e", lineHeight: 1.6 }}>
              클라이언트의 의뢰 생성과 결제 승인은 토스 등록 얼굴 기반 얼굴 인증 성공 후 {productConfig.faceAuthWindowMinutes}분 이내에만 가능해요.
            </p>
            <button style={{ ...secondaryButtonStyle, marginTop: 16 }} onClick={props.onStartFaceAuth}>
              토스 얼굴 인증 시작
            </button>
          </div>
        </div>
      </Panel>
      <Panel title="결제 및 정책 검사" subtitle="정책 검사를 통과해야 게시할 수 있어요.">
        <ul style={listStyle}>
          <li>금칙어, 은어, 야간 고액 패턴을 동기 검사해요.</li>
          <li>결제 버튼은 얼굴 인증 전까지 비활성화돼요.</li>
          <li>차량/1톤 조건에 맞는 부르미에게만 의뢰가 노출돼요.</li>
        </ul>
        <button
          style={{
            ...primaryButtonStyle,
            opacity: props.faceAuthValid ? 1 : 0.45,
            cursor: props.faceAuthValid ? "pointer" : "not-allowed"
          }}
          disabled={!props.faceAuthValid}
        >
          결제하고 요청 올리기
        </button>
      </Panel>
    </section>
  );
}

function NearbyJobsScreen() {
  return (
    <Panel title="근처 의뢰" subtitle="거리, 차량, 톤수, 사업자 조건으로 필터링된 목록입니다.">
      <div style={{ display: "grid", gap: 12 }}>
        {[
          { title: "문 앞 장보기 전달", amount: "18,000원", badge: "도보 가능" },
          { title: "소형 가구 이동", amount: "85,000원", badge: "차량 필요" },
          { title: "1톤 짐 옮기기", amount: "160,000원", badge: "1톤 검증 필요" }
        ].map((item) => (
          <article key={item.title} style={rowCardStyle}>
            <div>
              <h3 style={{ margin: 0 }}>{item.title}</h3>
              <p style={{ margin: "6px 0 0", color: "#78716c" }}>서초구 1.2km · 예상 도착 7분</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <StatusBadge label={item.badge} tone="brand" />
              <div style={{ marginTop: 8, fontWeight: 700 }}>{item.amount}</div>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function ActiveJobScreen() {
  return (
    <section style={gridTwoColumnStyle}>
      <Panel title="진행 상태" subtitle="완료 버튼보다 증빙이 먼저입니다.">
        <ol style={{ ...listStyle, paddingLeft: 18 }}>
          <li>MATCHED</li>
          <li>RUNNER_EN_ROUTE</li>
          <li>RUNNER_ARRIVED</li>
          <li>PICKED_UP</li>
          <li>DELIVERY_PROOF_SUBMITTED</li>
          <li>CLIENT_CONFIRM_PENDING</li>
        </ol>
      </Panel>
      <Panel title="실시간 채팅" subtitle="위험 대화는 즉시 차단하고 감사 로그를 남겨요.">
        <div style={cardStyle}>
          <p style={{ margin: 0, color: "#57534e" }}>시스템 배너: 개인정보를 보내지 마세요. 불법 요청 시 대화와 의뢰가 중단될 수 있어요.</p>
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <div style={chatBubbleStyle}>곧 도착해요.</div>
          <div style={{ ...chatBubbleStyle, justifySelf: "end", background: "#dcfce7" }}>건물 앞에 도착했어요.</div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button style={secondaryButtonStyle}>픽업 사진 올리기</button>
          <button style={{ ...secondaryButtonStyle, borderColor: "#fecaca", color: "#b91c1c" }}>위험 신고하기</button>
        </div>
      </Panel>
    </section>
  );
}

function ReviewsCommunityScreen() {
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

function ProfileScreen() {
  return (
    <Panel title="내 정보" subtitle="인증 상태와 안전 상태를 한 곳에 보여줘요.">
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="닉네임" value={mockSession.nickname} />
        <Field label="성인 인증" value="완료" />
        <Field label="안전수칙 확인" value="최신 버전 확인 완료" />
        <Field label="얼굴 인증 유효" value="민감 행위 전 재인증 가능" />
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

function QuickAction(props: { title: string; body: string }) {
  return (
    <div style={rowCardStyle}>
      <div>
        <strong>{props.title}</strong>
        <p style={{ margin: "6px 0 0", color: "#57534e" }}>{props.body}</p>
      </div>
      <StatusBadge label="바로가기" tone="brand" />
    </div>
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

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: 24,
  background: "linear-gradient(180deg, #f0fdfa 0%, #fffbeb 50%, #fffdf8 100%)",
  fontFamily: '"Pretendard", "Apple SD Gothic Neo", sans-serif'
};

const heroStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 24,
  alignItems: "flex-start",
  marginBottom: 24,
  padding: 28,
  borderRadius: 32,
  background: "linear-gradient(135deg, #134e4a 0%, #0f766e 55%, #115e59 100%)"
};

const tabStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 24
};

const tabButtonStyle: React.CSSProperties = {
  border: "none",
  color: "#0f172a",
  padding: "12px 16px",
  borderRadius: 999,
  fontWeight: 700
};

const panelStyle: React.CSSProperties = {
  background: "#fffefc",
  borderRadius: 32,
  padding: 24,
  border: `1px solid ${butoTheme.colors.line}`,
  boxShadow: butoTheme.shadow
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
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

const primaryButtonStyle: React.CSSProperties = {
  border: "none",
  background: butoTheme.colors.brand,
  color: "#f8fafc",
  fontWeight: 700,
  padding: "16px 20px",
  borderRadius: 999
};

const secondaryButtonStyle: React.CSSProperties = {
  border: `1px solid ${butoTheme.colors.line}`,
  background: "#ffffff",
  color: butoTheme.colors.ink,
  fontWeight: 700,
  padding: "14px 18px",
  borderRadius: 999
};

const gridTwoColumnStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 20
};

const listStyle: React.CSSProperties = {
  margin: 0,
  color: "#57534e",
  display: "grid",
  gap: 10,
  lineHeight: 1.6
};

const safetyScreenStyle: React.CSSProperties = {
  display: "grid",
  gap: 20,
  maxWidth: 920,
  margin: "0 auto"
};

const chatBubbleStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 20,
  background: "#f5f5f4",
  maxWidth: 360
};

