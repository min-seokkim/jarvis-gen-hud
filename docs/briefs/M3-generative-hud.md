# M3 빌드 브리프 — Generative HUD 코어 (제약 JSX 생성 + 샌드박스 + 자기치유)

> Cowork 작성 · Claude Code 핸드오프. **이게 평가 핵심 — "챗봇 탈출" 지점.**
> 재료: `docs/design-system.md`(프리미티브 계약·생성 규칙 §4~6), `AGENTS.md`(불변 원칙).
> 선행: **M2 완료**(`web/src/hud/` 프리미티브 + `index.ts`). 브랜치: `feature/generative-hud` → `dev` PR.
> 근거: S0 스파이크에서 **제약 JSX 출력계약(Probe B) 이미 PASS** — 이 브리프는 그 계약을 제품화한다.

## 목표 (Exit)
대화에서 "화면이 필요한" 요청(예: **"빌드 상태 보여줘"**)이 오면 → Hermes가 **허용된 HUD 프리미티브만으로 JSX를 생성** → 샌드박스에서 렌더 → **HudCanvas에 표시**. 렌더 에러는 자기치유로 복구. **한 작업(빌드 상태 HUD)이 끝에서 끝까지 도는 1회 완전 루프.**

## 핵심 루프
```
요청/맥락
 → (Hermes /v1) 제약 JSX 생성  [출력계약: 허용 컴포넌트·props만 · import 없음 · 데이터는 props]
   → 샌드박스 렌더  (scope = web/src/hud 프리미티브 + 주입 data 만)
      ├ 성공 → HudCanvas 표시 (skeleton → fill 모션, design-system §3)
      └ 에러 → 에러메시지 피드백 → 재생성(cap N=2) → 그래도 실패 시 <Alert severity="critical"> 폴백
```

## 범위
1. **생성 계약(시스템 프롬프트)** — 핵심:
   - "HUD를 **JSX로만** 출력한다. 사용 가능 컴포넌트 = `Panel, StatusPanel, ProgressBar, Gauge, Stat, Steps, Chart, Waveform, Alert, Badge, KeyValue` **이것뿐**."
   - import 금지 · 임의 HTML/inline 색 금지 · **최상위 `Panel` 1개** · 색은 `state` prop으로만.
   - **데이터(수치·시리즈)는 주어진 `data`를 참조**(숫자 지어내지 말 것).
   - 표현 불가하면 `<Alert severity="info">`로 솔직히.
   - S0 Probe B의 통과한 프롬프트를 출발점으로 재사용.
2. **HUD 생성 호출** — 대화 채널과 **별개의 전용 `/v1` 호출**로 JSX만 받는다(M3는 단순하게). JSX 생성엔 충분히 유능한 모델(강한 delegation 쪽). *(음성+HUD 동시성·`hud.delta` 통로 합류는 M5/통합 — 여기선 텍스트 트리거로 충분.)*
3. **샌드박스 렌더** — `react-live` `LiveProvider`/`LivePreview`, `scope`에 **hud 프리미티브 + 주입 data만**(fetch/window 등 미노출). `ErrorBoundary`로 감싸 앱이 안 죽게.
4. **자기치유 루프** — onError 캡처 → "이 JSX가 이 에러(`<msg>`)를 냈다. 허용 컴포넌트/props만으로 고쳐라" 재생성, **최대 2회**, 실패 시 `Alert critical` 폴백 + (dev) 원본 에러 표시. 무한 재시도 금지.
5. **데이터 바인딩 (불변 원칙)** — 모델은 **HUD 모양·프리미티브 선택만**. 수치·시리즈는 **deterministic 소스**에서 `data`로 주입. M3 데모는 빌드 상태 mock/fixture 함수로(`getBuildStatus()` 같은). LLM이 숫자 안 지어냄.
6. **데모 타깃 (보편 후크)** — "빌드 상태 보여줘" → `Steps`(done/active/pending/failed) + `ProgressBar` HUD. 실패 단계 빨강. 도메인 몰라도 즉시 이해.
7. **HudCanvas 통합** — placeholder 제거, 생성 HUD 표시. 생성 중 skeleton, 상태 모션 적용.

## 결정 필요 (구현 전, 장단점 1줄씩 제시 후 택1)
- **샌드박스: react-live(권장·M3) vs Sandpack/iframe(하드닝).** react-live는 가볍고 scope를 우리 프리미티브로 좁혀 blast radius를 제한 + ErrorBoundary면 데모에 충분. 단 `new Function` in-page라 **진짜 격리는 아님**. → **M3는 react-live + 엄격 scope + ErrorBoundary로 빠르게**, 진짜 iframe 격리(Sandpack/커스텀 iframe)는 시간 되면 하드닝(AGENTS의 'iframe 격리'는 하드닝 목표로 유지).
- **출력 형식:** 순수 JSX 코드블록 vs `{ "jsx": "..." }` JSON — 파싱·스트리밍 단순한 쪽.
- **트리거 판단:** "화면 필요" 여부 — M3는 간단히(명시 트리거/키워드 또는 항상 시도). 지능형 의도분류는 후속.

## 비범위 (M3 아님)
- 음성 파이프라인·동시성 → M5
- 본 적 없는 작업 일반화 확장 → M4 (M3는 빌드상태 1종으로 루프 완성)
- 진짜 iframe 격리 하드닝 → 시간 되면

## 검증 (완료 선언 전 — Claude Code가 먼저 통과)
- "빌드 상태 보여줘" → HudCanvas에 빌드 진행 HUD 렌더(Steps + ProgressBar, 실패 단계 빨강).
- 일부러 깨진 JSX가 나와도 → 자기치유 복구 또는 cap 후 `Alert` 폴백, **앱 안 죽음**.
- 생성 JSX가 허용 밖(임의 `<div style>` 등) 쓰면 거부/치유되는가(스코프·계약 강제 확인).
- 수치가 `data`(deterministic) 출처인가 — 모델이 숫자 지어내지 않음 확인.
- 자기치유 재시도 cap 동작(무한 루프 없음).
- `npm run build`/`typecheck`/`lint` 0, 모바일/PC 레이아웃 유지.

---

### Claude Code에 붙여넣을 프롬프트
```
[맥락] AGENTS.md, docs/design-system.md(§4~6 프리미티브·생성규칙·자기치유), docs/briefs/M3-generative-hud.md를 먼저 읽어.
       이게 이 프로젝트의 평가 핵심 = generative HUD다. M2의 web/src/hud 프리미티브가 생성 재료다.
[목표] (1) 제약 JSX 생성 계약(시스템 프롬프트): 허용 프리미티브만·import 없음·최상위 Panel 1개·데이터는 data prop.
       (2) Hermes /v1로 JSX 생성 호출(대화와 별개).
       (3) react-live 샌드박스(scope=hud 프리미티브+주입 data, ErrorBoundary)로 HudCanvas에 렌더.
       (4) 자기치유: 렌더 에러 → 에러 피드백 재생성(최대 2회) → 실패 시 Alert critical 폴백.
       (5) 데모: "빌드 상태 보여줘" → Steps+ProgressBar HUD(데이터는 deterministic mock).
[제약] TS. 생성 JSX는 허용 컴포넌트·토큰만(스코프로 강제). 수치는 data 출처(LLM이 숫자 생성 금지). 외부 라이브러리는 react-live 외 추가 시 먼저 물어볼 것.
[결정] 샌드박스 react-live vs Sandpack, 출력 형식(JSX vs JSON) — 장단점 1줄씩 제시 후 택1하고 진행. (react-live 권장)
[출력] feature/generative-hud 브랜치 작은 커밋들. 끝나면 build/typecheck/lint 통과 + "빌드 상태" 렌더 + 깨진 JSX 자기치유 데모 스크린샷/로그 + 스코프 강제 확인 보고.
[검증] 브리프 "검증" 체크리스트를 네가 먼저 통과시키고 보고.
```
