# 디자인 시스템 스펙 — 자비스 HUD (M2)

> Cowork 작성 · Claude Code 구현 핸드오프.
> 이 문서가 정의하는 **토큰 + HUD 프리미티브**가, generative HUD가 생성할 때 쓸 수 있는 **유일한 재료**다. M3에서 이 스코프만 LLM(샌드박스)에 노출한다. → `AGENTS.md`의 "디자인 토큰·허용 컴포넌트 스코프만 사용" 원칙의 구체화.

## 0. 원칙
- **자유 생성 + 디자인 언어 제약.** 생성 JSX는 아래 토큰/프리미티브만 사용. raw 색·임의 inline style·외부 라이브러리 금지.
- **다크 홀로그램 미감.** 근-검정 배경 + 청록 홀로그램 accent + **파랑(안정) ↔ 빨강(경고)** 상태축.
- **엔지니어링 readout 톤.** 수치·데이터는 mono. 장식보다 정보 밀도.
- **데이터는 props로 들어온다.** 컴포넌트는 표현만; 계산·수치는 deterministic 코드가 채운다(LLM이 숫자 지어내지 않음).
- **색 의미축 보호 (중요).** 상태색(`stable/info/caution/critical`)은 **의미 전용**이다. 시각적 풍부함(heat·다중 시리즈)은 상태색을 **절대 재사용하지 않고** 비의미 팔레트(`--seq-*` 크기·강도, `--cat-*` 카테고리)로만 표현한다. 예: "값이 큼"인 빨강 막대는 `--seq-*`(heat)이지 `--state-critical`(경고)이 아니다. 상태는 오직 `state` prop으로만 들어온다.

---

## 1. 디자인 토큰 (CSS custom properties — 실제 값)

```css
:root {
  /* ── surface ── */
  --bg:        #060a0f;   /* 앱 배경(근-검정, 약한 청기) */
  --surface:   #0c1620;   /* 패널 */
  --surface-2: #122231;   /* 패널 위 요소 */
  --line:      rgba(34,211,238,.18);  /* 테두리(홀로그램) */
  --grid:      rgba(34,211,238,.08);  /* 그리드/가이드 */

  /* ── holographic accent ── */
  --accent:        #22d3ee;
  --accent-strong: #38e0f0;
  --accent-glow:   rgba(34,211,238,.35);

  /* ── text ── */
  --text:     #e6f6fb;
  --text-mid: #9fc4cf;
  --text-dim: #5f7c88;

  /* ── state axis: 파랑(안정) ↔ 빨강(경고) ── */
  --state-stable:   #3b82f6;  /* ok / 안정 */
  --state-info:     #22d3ee;  /* 정보 (= accent) */
  --state-caution:  #f59e0b;  /* 주의 */
  --state-critical: #ef4444;  /* 경고 / 실패 */
  --state-stable-bg:   rgba(59,130,246,.14);
  --state-info-bg:     rgba(34,211,238,.12);
  --state-caution-bg:  rgba(245,158,11,.14);
  --state-critical-bg: rgba(239,68,68,.14);

  /* ── NON-semantic richness palettes (상태색 재사용 금지) ── */
  /* sequential / heat: 크기·강도(쿨→웜). heat 막대·밀도 색 전용. */
  --seq-0:#22d3ee; --seq-1:#5eead4; --seq-2:#a3e635; --seq-3:#fbbf24; --seq-4:#fb7185;
  /* categorical: 다중 시리즈/카테고리(청록·인디고·민트·바이올렛·앰버·핑크·스카이·라임). */
  --cat-0:#22d3ee; --cat-1:#818cf8; --cat-2:#34d399; --cat-3:#c084fc;
  --cat-4:#fbbf24; --cat-5:#f472b6; --cat-6:#38bdf8; --cat-7:#a3e635;

  /* ── typography ── */
  --font-ui:   -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
  --fs-xs:.72rem; --fs-sm:.82rem; --fs-md:.95rem; --fs-lg:1.15rem; --fs-xl:1.6rem; --fs-2xl:2.4rem;
  --lh: 1.5;

  /* ── spacing (4px base) ── */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-6:24px; --sp-8:32px;

  /* ── radius ── */
  --r-sm:6px; --r-md:10px; --r-lg:14px; --r-pill:999px;

  /* ── elevation ── */
  --shadow: 0 6px 24px rgba(0,0,0,.45);
  --glow:   0 0 0 1px var(--line), 0 0 24px -8px var(--accent-glow);

  /* ── motion ── */
  --dur-fast:120ms; --dur:200ms; --dur-slow:360ms;
  --ease: cubic-bezier(.2,.7,.2,1);
}
```

규칙: 컴포넌트는 위 변수만 참조한다. 새 색/하드코딩 hex 금지(상태는 `state` prop으로만). 풍부함(heat·다중 시리즈)은 `--seq-*`/`--cat-*`로만 — 상태색과 별개 축이다.

---

## 2. 상태 매핑 (semantic)
컴포넌트는 raw 색이 아니라 **의미(state)** 만 받는다.

```ts
type State = "stable" | "info" | "caution" | "critical";
// stable=파랑(안정), info=청록(정보), caution=주황(주의), critical=빨강(경고/실패)
type Size = "sm" | "md" | "lg";
```

### 비의미 색축 (richness — ≠ state)
다중 시리즈·heat 등 "풍부함"은 상태색을 **재사용하지 않는다**(의미 혼선 방지).
- `--seq-0..4` — sequential/heat 램프(크기·강도; 쿨→웜). heat 막대·밀도 색 전용.
- `--cat-0..7` — categorical(시리즈/카테고리 구분; 청록 외 ≥6 휴).

규칙: "값 큼"(heat 막대 등)=`--seq-*`, 다중 시리즈/카테고리=`--cat-*`, 상태(경고/안정)=`state` prop. **셋은 독립 축**이며 서로 침범하지 않는다. PieChart/Chart heat 등은 `state`가 없을 때만 비의미 팔레트를 쓰고, `state`가 주어지면 의미색을 따른다.

> 동일 수치를 `Stat`과 `KeyValue`로 **중복 표기하지 말 것**(한 곳에서만). 한 HUD = 2–4 프리미티브, 그래픽 우선.

---

## 3. 모션 언어
| 상황 | 모션 |
|---|---|
| idle | accent glow 은은한 pulse (`--dur-slow`, 무한) |
| listening | accent 파형/펄스 |
| thinking·rendering | 스켈레톤 → 점진 fill (`--dur`~`--dur-slow`) |
| 상태 전환 | color/opacity `transition: var(--dur) var(--ease)` |
| self-heal | 재생성 시 fade-replace(`--dur-fast` out → in) |

```css
@keyframes hudPulse { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes hudSweep { from{transform:translateX(-100%)} to{transform:translateX(100%)} }
/* prefers-reduced-motion: reduce 시 애니메이션 정지 */
```

---

## 4. HUD 프리미티브 카탈로그
**생성 시 허용되는 유일한 컴포넌트.** 각 props는 계약(추가 prop·raw style 금지). 모든 컴포넌트는 토큰만 사용.

### Panel — 모든 HUD의 컨테이너
```ts
interface PanelProps {
  title?: string;
  state?: State;            // 테두리/타이틀 강조색
  children: ReactNode;
  span?: 1 | 2 | 3;         // 그리드 칸 수
}
```
HUD 한 개 = 최상위 `Panel` 하나(또는 `Panel`들의 그리드).

### StatusPanel — 라벨 + 상태 큰 표시
```ts
interface StatusPanelProps { label: string; value: string; state: State; hint?: string; }
```

### ProgressBar
```ts
interface ProgressBarProps { value: number; /* 0..100 */ label?: string; state?: State; showPct?: boolean; }
```

### Gauge — 원호 게이지
```ts
interface GaugeProps { value: number; min?: number; max?: number; unit?: string; label?: string; state?: State; }
```

### Stat — KPI 수치
```ts
interface StatProps { label: string; value: string | number; unit?: string; delta?: number; state?: State; }
```

### Steps — 순서 단계 진행 (빌드 상태 데모 핵심)
```ts
type StepStatus = "done" | "active" | "pending" | "failed" | "caution";
interface StepsProps { steps: { name: string; status: StepStatus }[]; }
// failed → critical 색, active → accent, done → stable, caution → 주의(partial), pending → dim
```

### Chart — 작은 데이터 차트 (데이터 in, 표현만)
```ts
interface ChartProps {
  kind: "line" | "bar" | "area";
  data: { x: string | number; y: number }[];
  unit?: string; label?: string; state?: State;
}
```

### Waveform — 신호/파형 (엔지니어링 archetype)
```ts
interface WaveformProps { samples: number[]; label?: string; state?: State; }
```

### RadialMeter — 동심 레이더 KPI (단일 핵심 수치 + 맥락)
```ts
interface RadialMeterProps { value: number; max?: number; label?: string; unit?: string; state?: State; }
// 중앙 readout=value, 링 채움=value/max. "47 INCIDENTS" 같은 헤드라인 KPI. 손 SVG.
```

### Sparkline — 인라인 미니 트렌드 (축·마커 없음)
```ts
interface SparklineProps { samples: number[]; label?: string; state?: State; }
// 스탯 행/타일 옆 작은 추세. Waveform의 chrome 제거판. samples는 data.*에서.
```

### RadialBreakdown — 허브 둘레 카테고리 스포크 (+ 중앙 합계)
```ts
interface RadialBreakdownProps {
  items: { label: string; value: number; state?: State }[];
  label?: string; unit?: string; state?: State;
}
// 카테고리별 값 분해(ATT&CK 룩). 스포크 길이=값, 색은 state면 의미색·없으면 --cat-*, 중앙=total.
```

### PieChart — 도넛 카테고리 분해 (+ 중앙 합계)
```ts
interface PieChartProps {
  slices: { label: string; value: number; state?: State }[]; // data 별칭 허용
  label?: string; state?: State;
}
// 도넛 분해. 슬라이스 색은 state면 의미색·없으면 --cat-*, 중앙=total.
```

### Alert — 메시지
```ts
interface AlertProps { severity: State; title: string; message?: string; }
```

### Badge / KeyValue — 보조
```ts
interface BadgeProps { text: string; state?: State; }
interface KeyValueProps { items: { k: string; v: string }[]; }   // 라벨-값 목록
```

---

## 5. 생성 규칙 (M3에서 LLM 시스템 프롬프트로 주입)
- 위 컴포넌트만, **import 없이** 스코프에서 사용. 새 컴포넌트 발명 금지.
- 색·간격·폰트는 토큰 또는 `state`/`size` prop으로만. **inline 임의 색·style 금지.**
- 수치·시리즈 데이터는 props로 받는다(LLM이 계산하지 않음).
- 한 HUD = 최상위 `Panel` 1개 또는 `Panel` 그리드.
- 표현할 수 없는 작업이면 `Alert severity="info"`로 솔직히 표시.

### 5.1 Anti-plain (절제된 생성 — 풍부함이 잡탕/표가 되지 않게)
- **텍스트 리스트(`Steps`/`KeyValue`)만으로 HUD를 채우지 말 것** — 최소 1개 graphic/지표 프리미티브를 lead로. (검증기가 text-list-only를 거부)
- **같은 데이터를 여러 프리미티브로 중복 표시 금지** — 한 리스트를 `Steps`+`Chart`+`KeyValue`로 3중복 ✗. 리스트 1개(상태색 `Steps`+설명) + 요약 그래픽 1개.
- **ordinal/순서를 `Chart`·`Waveform`으로 그리지 말 것** — 단계 번호·목록 순번은 정량 시리즈가 아니다(무의미한 평평한 라인). 진행은 `RadialMeter`/`Stat`("7/9"), 상태 분포는 `RadialBreakdown`.
- 상태가 있는 리스트 항목엔 **항목별 `status`를 부여**(done/active/caution=partial/pending/failed) — 단색 방지. 항목 detail은 `Steps`의 `description`에(병렬 `KeyValue` 중복 ✗).
- **process/pipeline 아키타입:** 상태색 `Steps`(설명 포함) + 요약 `RadialMeter`/`Stat`.

## 6. M3 연결
- 이 카탈로그가 **react-live/Sandpack 스코프**로 그대로 주입된다(허용 컴포넌트 = 이 목록).
- **자기치유:** 렌더 에러(허용 외 컴포넌트/prop/문법)를 에러로 다시 먹여 재생성, 재시도 cap 후 `Alert critical` 폴백.
- 검증 체크포인트는 `docs/agent-workflow.md` §3의 "Generative HUD" 항목과 일치.

---
### 다음 (Cowork)
- M3 빌드 브리프(제약 JSX 생성 계약 + 샌드박스 + 자기치유)는 이 스펙을 재료로 작성 예정.
- 구현 시 Claude Code는 이 토큰을 `web/`의 전역 CSS로, 프리미티브를 `web/src/hud/`의 컴포넌트로 만든다.
