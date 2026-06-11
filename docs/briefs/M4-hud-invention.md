# M4 빌드 브리프 — HUD 발명 (본 적 없는 작업 일반화 · agent-supplied data)

> Cowork 작성 · Claude Code 핸드오프. **데모의 "마법" 비트 — 미리 만들지 않은 작업에서 HUD가 태어나는 순간.**
> 재료: `docs/briefs/M3-generative-hud.md`(완료·머지), `docs/decisions/0002-hermes-feasibility.md`(#3·#11·R2·R3), `AGENTS.md`(불변 원칙).
> 선행: **M3 완료**(생성 계약 + react-live 샌드박스 + 자기치유 cap2 + 검증 게이트). 브랜치: `feature/hud-invention` → `dev` PR.
> 핵심 전환: **HUD 호출을 "도구 없는 JSX 전용 2차 호출"(M3)에서 "Hermes 에이전트 턴"(도구 실행 포함)으로 승격.** 프론트는 안전한 렌더러로 남는다.

## 목표 (Exit)

미리 코딩하지 않은 작업 요청(예: "이 repo 의존성 취약점 봐줘", "디스크 사용량 보여줘")이 오면 → Hermes가 **턴 안에서 도구(terminal/code_execution)로 deterministic 데이터를 수집**하고 → `{say, data, jsx}` **envelope**로 응답 → 프론트가 `data`를 샌드박스 스코프에 주입, `jsx`를 기존 검증 게이트로 통과시켜 렌더. **본 적 없는 작업 3종 중 2종 이상에서 HUD가 발명되면 Exit.**

## 핵심 루프 (M3와의 차이)

```
요청 → [트리거: 관대한 휴리스틱]
 → Hermes /v1 에이전트 턴  (api-server 툴셋: terminal·code_execution·file — ADR 0002 #3 검증됨)
     ├ 도구 실행으로 데이터 수집 (LLM이 숫자 생성 ❌ — 툴 출력 JSON을 그대로 data에)
     ├ 디자인 사고 (design 필드를 jsx보다 먼저 쓰게 강제 — "이 작업에 맞는 HUD 형태는?")
     └ envelope 출력: { "say": "한 줄", "design": {…사고 결과…}, "data": {…툴 출력…}, "jsx": "<Panel>…" | null }
 → 프론트: data → react-live 스코프 주입 · jsx → assertValidHudJsx → 렌더
     ├ jsx: null → HUD 안 그림 (화면 불필요 판단은 모델이; 트리거 오발동 무해화)
     └ 에러 → 기존 자기치유 cap2 → Alert 폴백  (M3 메커니즘 그대로)
```

## 선행 스파이크 S1 — envelope 계약 안정성 (코드 착수 전, 반드시)

ADR 0002 R2·R3의 연장. `hermes_spike.py`를 확장해 **실제 Hermes 턴**(도구 포함)에 envelope 시스템 프롬프트를 주고:

- 미리 안 만든 작업 3종(예: `npm audit` 요약 / `df -h` 디스크 / `git log` 최근 활동)을 던진다.
- **Exit:** 3종 중 2종 이상에서 ① 유효 JSON envelope ② `data`가 툴 출력과 일치(수동 대조) ③ `jsx`가 검증 게이트 통과 ④ **프리미티브 선택이 data_kind에 적합**(디스크→`Gauge`, 빌드→`Steps` — 셋 다 Steps+ProgressBar면 FAIL). 미달이면 프롬프트 보강 1회 후 재시도, 그래도 미달이면 범위 축소 보고.
- ⚠️ 반드시 `127.0.0.1`(localhost는 IPv6 함정 — [[hybrid-routing]] 실측). 툴 턴 지연 ~12s는 정상(스켈레톤이 가린다).

## 범위

1. **Envelope 계약 (시스템 프롬프트 v2)** — M3 `HUD_SYSTEM_PROMPT` 확장:
   - 출력은 JSON only, **키 순서 고정**: `{"say": string, "design": object, "data": object, "jsx": string|null}` — `design`이 `jsx`보다 먼저 오게 해 **JSX를 짜기 전에 디자인 사고를 강제**한다(스키마-강제 CoT).
   - **`design` 필드 (필수, jsx가 null이 아니면):** `{"data_kind": "...", "primitives": [...], "layout": "...", "why": "한 줄"}`. 프론트는 dev 모드에서 이걸 콘솔/캔버스 캡션에 표시(생성 품질 디버깅), 자기치유 시 컨텍스트로 재주입.
   - **`data`는 도구 실행 결과를 그대로 전달**(passthrough). 수치를 만들거나 고치지 말 것. 가능하면 `data._source`에 `{tool, command, exitCode}` 명시.
   - `jsx`는 M3 규칙 그대로(허용 11종만 · import/raw HTML/inline 색 금지 · 최상위 Panel 1개 · **수치는 `data.*` 참조만**).
   - 화면이 불필요하거나 데이터 수집 실패면 `jsx: null` + `say`로 설명. 표현 애매하면 `<Alert severity="info">`.
1-b. **Archetype 매핑 + 그래픽 밀도 규칙 (시스템 프롬프트에 포함)** — "데이터 의미 → 표현"을 명시해 천편일률 방지:

   | data_kind (의미) | 1순위 프리미티브 | 예 |
   |---|---|---|
   | progress/pipeline (단계 진행) | `Steps` + `ProgressBar` | 빌드, 배포, 테스트 스위트 |
   | utilization/capacity (0–100 점유) | **`Gauge`**(항목당 1개) + `Stat` | 디스크, 메모리, CPU |
   | timeseries (시간 추세) | `Chart kind="line"`/`"area"` | 응답시간, 로그 빈도 |
   | comparison (항목 비교) | `Chart kind="bar"` | 패키지 크기, 브랜치별 커밋 |
   | signal (파형) | `Waveform` | 오디오, 센서 |
   | status/overview (요약) | `StatusPanel` + `KeyValue` + `Badge` | repo 상태, 서비스 헬스 |

   - **그래픽 우선**: 같은 정보를 숫자 나열(`KeyValue`)과 그래픽(`Gauge`/`Chart`/`Steps`) 둘 다로 표현할 수 있으면 **그래픽을 1순위**, KeyValue는 보조 디테일로.
   - **구성 밀도**: 단일 위젯 하나로 끝내지 말 것 — 핵심 그래픽(크게) + 보조 `Stat`/`Badge` + 디테일 `KeyValue`를 **`Panel` 그리드(`span`)로 2–3개 구성**. 임계값 의미는 `state` prop으로(예: 디스크 90%↑ → `critical`).
   - "방금 전 작업과 같은 레이아웃 금지" 류의 다양성 지시 1줄 포함.
1-c. **하드코딩 힌트 제거 (회귀 원인)** — 현재 `generateHudJsx()`가 모든 호출의 user 메시지에 `'For the build status demo, prefer Steps + ProgressBar'`를 박아 넣는다 → **삭제**. 빌드 데모 경로는 task 문자열로 자연 유도되거나, 데이터 소스별 힌트를 data에 동봉하는 방식으로만.
2. **프론트 데이터 일반화** — `HudData` 고정 인터페이스(`{build, project?}`) → **임의 JSON**(`Record<string, unknown>`):
   - `describeHudDataShape()`를 일반 JSON shape walker로 교체(키·타입·배열 원소 shape 요약, depth cap ~3, 길이 cap).
   - 스코프 주입은 동일(`data` 하나). 검증 게이트·자기치유·폴백은 **수정 없이 재사용**이 원칙.
   - 기존 빌드/프로젝트 데모 경로는 회귀 없이 유지(M3 e2e 깨지지 않게 — envelope에 기존 데이터를 실어도 됨).
3. **HUD 턴 호출 교체** — `generateHudJsx()`가 envelope 턴을 호출하도록: 응답에서 `data`·`jsx` 추출, `say`는 대화 패널에 한 줄로(채팅 스트림과 중복되면 생략 가능 — 결정 D1 참조).
4. **트리거 완화** — 키워드 목록을 "동사형 요청 휴리스틱"으로 넓힌다(보여/확인/봐/상태/얼마나/why류 + 물음표). **오발동은 무해**: 모델이 `jsx:null`이면 HUD 안 뜸. 지능형 의도분류는 M5(fast 메인 dispatch)로.
5. **수치 검증 완화 1건** — `assertValidHudJsx`의 하드코딩 숫자 규칙은 유지하되, 배열 prop(`steps=`, `samples=`, `data=`)은 **`data.`로 시작하는 참조만 허용** 규칙 추가(M3 리뷰 지적 ③ 반영).
6. **landmine 제거(1줄)** — `vite.config.ts` 기본 타깃 `http://localhost:8642` → `http://127.0.0.1:8642`.
7. **데모 시나리오 (마법 비트)** — 발표에서 "관객이 즉석 제안한 작업"처럼 보이는 미준비 작업 1개 + 리허설된 미준비 작업 1개(S1에서 통과한 것 중). *stretch:* KiCad `kicad-cli pcb drc --format json`(워크스테이션에 설치돼 있을 때만, 핵심 데모에 안 넣음).

## 결정 필요 (구현 전, 장단점 1줄씩 제시 후 택1)

- **D1 — 채팅 채널과의 관계:** ① 2-호출 유지(채팅 스트리밍 그대로 + HUD envelope 턴 별도; M1 UX 보존, diff 작음 — **권장**) vs ② 단일 envelope 턴으로 통합(코히어런스 완벽하나 스트리밍 UX 깨짐, M5에서 오케스트레이터가 풀 문제). ①이면 같은 질문에 채팅 답과 HUD 데이터가 미세하게 어긋날 수 있음을 수용(R2, 데모 허용 범위).
- **D2 — envelope 파싱 강건성:** 모델이 JSON 밖 텍스트를 흘릴 때 — 코드블록/중괄호 추출 재사용(M3 `extractHudJsx` 패턴 일반화) vs 엄격 거부 후 자기치유. (관대 추출 + 실패 시 치유 권장.)
- **D3 — `data` 크기 cap:** 툴 출력이 클 때(예: npm audit 전체) 프롬프트·스코프에 그대로 넣을 수 없음 — 모델에게 "요약 JSON으로 추려 담아라" 지시 vs 프론트 truncate. (모델 추림 + 프론트 50KB hard cap 권장.)

## 비범위 (M4 아님)

- 음성 동시성·`hud.delta` 스트리밍·fast 메인 의도분류 → M5
- `terminal(background=True)` 긴 작업의 진행 HUD 갱신 → M5/후속 (S1에서 동기 툴만)
- 진짜 iframe 격리 하드닝, 스킬 영속 큐레이션, Table/Tree 프리미티브 추가 → 데모 후
- SolidWorks류 Windows COM 어댑터 → 안 함 (WSL 경계 밖)

## 검증 (완료 선언 전 — Claude Code가 먼저 통과)

- 미준비 작업 3종 중 ≥2종: HUD 발명 + **HUD 수치가 툴 실제 출력과 일치**(터미널 대조).
- **표현 적합성**: 빌드(Steps)와 디스크(Gauge)가 **서로 다른 그래픽**으로 나오는가. KeyValue-only(그래픽 0) HUD가 아닌가. Panel 그리드 구성(span)을 활용하는가.
- `jsx:null` 경로: HUD 안 뜨고 채팅만 정상.
- 깨진 envelope/JSX → 자기치유 또는 Alert 폴백, **앱 안 죽음** (M3 e2e 회귀 0).
- 배열 prop 하드코딩(`steps={[…]}`)이 거부되는가.
- 트리거 오발동(잡담) 시 사용자 체감 무해한가.
- `npm run build`/`typecheck`/`lint` 0 · 기존 Playwright e2e 통과 + envelope mock e2e 1본 추가.

---

### Claude Code에 붙여넣을 프롬프트

```
[맥락] AGENTS.md, docs/briefs/M4-hud-invention.md, docs/briefs/M3-generative-hud.md, docs/decisions/0002-hermes-feasibility.md를 먼저 읽어.
       M3 루프(생성→검증→렌더→자기치유)는 완성·머지됨. M4 = HUD 호출을 Hermes 에이전트 턴(도구 실행)으로 승격하고
       data를 임의 JSON으로 일반화해 "본 적 없는 작업의 HUD 발명"을 만든다.
[선행] S1 스파이크: hermes_spike.py 확장 — envelope {say,data,jsx} 계약이 실제 도구 턴에서 안정적인지 3작업으로 확인(127.0.0.1!).
       Exit 미달이면 멈추고 보고.
[목표] (1) envelope 시스템 프롬프트 v2 — 키 순서 say→design→data→jsx로 디자인 사고 강제,
           archetype 매핑 표(브리프 1-b)와 그래픽 밀도 규칙 포함, data=툴 출력 passthrough, 불필요시 jsx:null
       (1-c) generateHudJsx의 하드코딩 빌드 힌트('prefer Steps + ProgressBar') 삭제
       (2) HudData 고정 인터페이스 → 임의 JSON + shape walker로 describeHudDataShape 일반화
       (3) generateHudJsx를 envelope 턴 호출로 교체 (검증 게이트·자기치유·폴백은 그대로 재사용, design은 치유 컨텍스트에 재주입)
       (4) 트리거 휴리스틱 완화 (오발동은 jsx:null로 무해화) (5) 배열 prop data-참조 강제 규칙 추가
       (6) vite.config 기본 타깃 127.0.0.1로 (7) envelope mock e2e 1본 (빌드≠디스크 프리미티브 차이 검증 포함)
[제약] TS. 외부 라이브러리 추가 금지. 검증 게이트 완화 금지(추가만 가능). 기존 빌드/프로젝트 데모·e2e 회귀 0.
[결정] D1(2-호출 vs 단일 턴)·D2(관대 추출 vs 엄격)·D3(data cap) — 장단점 1줄씩 제시 후 택1하고 진행. (권장안 브리프에 있음)
[출력] feature/hud-invention 브랜치 작은 커밋들. 끝나면 미준비 작업 2종 HUD 스크린샷/로그 + 수치-툴출력 대조 + 검증 체크리스트 통과 보고.
[검증] 브리프 "검증" 체크리스트를 네가 먼저 통과시키고 보고.
```
