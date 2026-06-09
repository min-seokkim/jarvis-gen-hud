# M2 빌드 브리프 — 디자인 시스템 구현 (토큰 + HUD 프리미티브)

> Cowork 작성 · Claude Code 핸드오프. **스펙 본체 = `docs/design-system.md`** (이 브리프는 그걸 web/ 코드로 옮기는 빌드 지침).
> 브랜치: `feature/design-system` → `dev` PR. AGENTS.md 준수.

## 목표 (Exit 조건)
`docs/design-system.md`의 토큰과 HUD 프리미티브가 **실제 React 컴포넌트로 존재**하고, **상태별로 렌더되는 갤러리**에서 눈으로 확인된다. (LLM이 이걸로 HUD를 생성하는 건 M3 — 이번엔 재료만 만든다.)

## 범위
1. **디자인 토큰** — `docs/design-system.md` §1의 CSS 변수를 전역 스타일로(`web/src/styles/tokens.css`). 앱 전역에서 사용. ⚠️ **이 파일은 M1에서 이미 존재** → `design-system.md` §1을 **정본으로 기존 파일을 교체/확장**(토큰 중복·충돌 정의 금지). 기존 M1 화면이 토큰명을 참조 중이면 깨지지 않게 맞춘다.
2. **상태 타입** — `web/src/hud/types.ts`에 `State`("stable"|"info"|"caution"|"critical"), `Size`.
3. **HUD 프리미티브** — `web/src/hud/`에 §4 카탈로그 전부, props 계약 그대로:
   Panel · StatusPanel · ProgressBar · Gauge · Stat · Steps · Chart · Waveform · Alert · Badge · KeyValue.
   - 각 컴포넌트는 **토큰만** 사용(하드코딩 색·임의 inline style 금지). 색은 `state` prop → 토큰 매핑으로만.
   - `web/src/hud/index.ts`에서 모두 export(= M3에서 샌드박스 스코프로 주입할 단일 진입점).
4. **갤러리** — `/gallery` 라우트(또는 토글)에서 모든 프리미티브를 상태별(stable/info/caution/critical)·사이즈별로 나열. 사람이 디자인 언어를 눈으로 검수하는 용도.

## 제약 (AGENTS.md)
- TypeScript, 함수형 컴포넌트, props는 계약대로(추가 prop·raw style 금지).
- **외부 라이브러리 금지.** 특히 **Chart·Waveform은 차팅 라이브러리 없이 최소 SVG로 직접** 그린다(line/bar/area, 파형). 정 라이브러리가 필요하다고 판단되면 **먼저 묻기**.
- 데이터는 props로만 받는다(컴포넌트가 수치 생성/계산하지 않음).
- 모션은 §3 토큰 사용 + `prefers-reduced-motion` 존중.

## 비범위 (이번엔 안 함)
- 제약 JSX 생성·샌드박스·자기치유 → **M3**
- HudCanvas에 실제 생성 결과 렌더 → M3 (지금 HudCanvas는 placeholder 유지)

## 검증 (완료 선언 전)
- `npm run build` / `typecheck` / `lint` 에러 0.
- `/gallery`에서 모든 프리미티브가 4개 상태로 렌더되고 색이 의미대로(stable=파랑, info=청록, caution=주황, critical=빨강).
- **하드코딩 색 점검:** `web/src/hud`에서 `#`(hex)·`rgb(` 직접 사용 0건 — 전부 `var(--…)` 또는 `state` 경유 (grep으로 확인).
- 데모용 조합 1개: `Steps`(done/active/pending/failed) + `ProgressBar`로 "빌드 상태 HUD" 목업이 갤러리에 보이는가(M3 데모의 보편 후크 대비).
- 반응형: 갤러리가 모바일 폭에서 안 깨짐.

## 결정 필요
- Chart/Waveform 구현: 최소 SVG 직접(권장, 무의존) vs 라이브러리(묻고). → 직접 권장.
- 갤러리 노출: 별도 라우트 vs dev 전용 토글. 편한 쪽, 단 프로덕션 번들 부담 없게.

---

### Claude Code에 붙여넣을 프롬프트 (패턴 A)
```
[맥락] AGENTS.md와 docs/design-system.md를 먼저 읽어. 우리는 generative HUD 자비스를 만든다.
       이번엔 그 "재료" — 디자인 토큰 + HUD 프리미티브 컴포넌트 — 를 구현한다(브리프: docs/briefs/M2-design-system.md).
[목표] design-system.md의 토큰을 web/src/styles/tokens.css 전역으로, §4 프리미티브 전부를 web/src/hud/에 props 계약대로 구현,
       web/src/hud/index.ts로 export, 그리고 모든 프리미티브를 상태별로 보여주는 /gallery를 만든다.
[제약] TS. 토큰만 사용(하드코딩 색 금지, 색은 state prop 경유). 외부 라이브러리 금지 —
       Chart/Waveform은 최소 SVG로 직접 그려라(라이브러리 쓰려면 먼저 물어볼 것). 데이터는 props로만.
[출력] feature/design-system 브랜치에 작은 커밋들로. 끝나면 build/typecheck/lint 통과 + /gallery 스크린샷 + 하드코딩 색 0건 확인 보고.
[검증] 브리프의 "검증" 체크리스트를 네가 먼저 통과시키고 결과를 보고해.
```
