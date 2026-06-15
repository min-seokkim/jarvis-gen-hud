# 도구 실행 중 HUD 라이브 진행 표시 — Claude Code 핸드오프 브리프

> 스펙 작성 = Cowork. **구현·검증 = Claude Code.** **AGENTS.md 준수.**
> 브랜치 제안: `feature/hud-tool-activity` → `dev` PR. 선행: usher TTFT(`docs/briefs/usher-ttft-handoff.md`)와 별개 기능(한 PR = 한 기능).

## 한 줄

envelope 턴이 **도구를 도는 동안** HUD 캔버스를 비워두지 말고, **도구 실행 타임라인 + 정제된 로그**를 라이브로 채운다. 본 HUD가 완성되면 그 자리에서 교체. (지금은 HUD가 뜰 때까지 그냥 기다림.)

## 배경 (왜)

- usher가 *말*로는 즉답하지만, **HUD 캔버스**는 envelope 완성(도구 수집→data→design→jsx)까지 비어 있다.
- HudCanvas에는 이미 `generating` 페이즈가 있으나 **제네릭 `HudSkeleton`(스피너)** 만 보여준다 → 진행 정보 0.
- 메인 스트림은 이미 `onToolEvent`(→ `handleToolEvent`)로 도구 call/output 이벤트를 흘린다. **지금은 상태바만 갱신**하고 HUD엔 안 쓴다. 이걸 HUD로 끌어올린다.

## 사용자 결정

- 깊이 = **타임라인 + 정제 로그(best-effort)**. 도구별 실행/완료 스텝 + 추출 가능하면 명령/출력 한 줄. SSE가 인자/출력을 안 주면 자동으로 타임라인만.

## 설계

**0) 먼저 확인(스파이크).** Hermes `/v1/responses` SSE에서 도구 이벤트 `item`이 실제로 어떤 필드를 담는지 **한 번 캡처해서 확인**한 뒤 정제기를 짜라(추측 금지 — AGENTS). `scripts/hermes_responses_spike.py`를 확장하거나 임시 스파이크로 한 번의 도구 턴(예: "디스크 사용량 보여줘")의 raw 이벤트를 덤프해, `function_call`/`function_call_output` item의 `arguments`·`output`·`content`·`name`·`call_id` 등 **존재하는 키**를 적어 둘 것. 정제 로직은 관측된 필드명에만 의존하게.

**1) 활동 모델 (App.tsx)**
```ts
interface ToolActivity {
  id: string;            // call_id 또는 순번
  name: string;          // formatToolName(event.name): terminal/code_execution/file/...
  status: StepStatus;    // 'active' | 'done' | 'failed'  (hud/types.ts)
  detail?: string;       // 정제된 명령/출력 한 줄(없으면 생략)
}
```

**2) `handleToolEvent` 확장**
- `phase:'call'` → 직전 `active` 항목을 `done`으로 내리고, 새 항목 push(`status:'active'`, `detail = 정제(call)`). 상태바 갱신은 유지.
- `phase:'output'` → 해당 도구(같은 `call_id`/`name`의 최근 항목)를 `done`으로, `detail`을 출력 요약으로 보강.
- 매 이벤트마다 `setHud({ phase:'generating', activity:[...], message:'작업 수행 중' })`.
- **첫 도구 이벤트에서만** generating 진입(도구 안 쓰는 턴은 진행 HUD 안 뜸).

**3) 정제 `extractToolDetail(item, phase): string | undefined`** — best-effort.
- call: `item.arguments`(JSON 문자열이면 parse)에서 `command|cmd|path|query|file` 중 첫 값; 아니면 생략.
- output: `item.output|content|text`의 **첫 줄**만, 공백/개행 정리 후 **80자 트렁케이트**.
- 추출 실패 → `undefined`(타임라인만). **절대 LLM/임의 텍스트로 채우지 말 것**(도구 출력 원문만).

**4) HudCanvas `generating` 분기**
- `hud.activity?.length` 있으면 **`HudProgress`** 렌더, 없으면 기존 `HudSkeleton`.
- `HudProgress` = 손으로 짠 컴포넌트(LLM JSX 아님 → **iframe 샌드박스 불필요**, `HudFallback`처럼 직접 렌더). 디자인 시스템 프리미티브만 사용:
  ```tsx
  <Panel title="작업 진행 중" state="info">
    <StatusPanel label="도구" value={`${doneCount}/${total}`} state="info" hint="실행 중" />
    <Steps steps={activity.map(a => ({ name: a.name, status: a.status, description: a.detail }))} />
  </Panel>
  ```
  (`Steps` StepItem = `{name,label,status,state,description}`; `StepStatus = done|active|pending|failed` — `hud/index.ts`에서 import.)

**5) 수명 관리**
- `HudRenderState`에 `activity?: ToolActivity[]` 추가(HudCanvas.tsx).
- 본 HUD 렌더(`setRenderedHud`) 시 자연 교체.
- **HUD 없음(jsx=null)/비-envelope/`!received`/에러/중단** 시 generating(activity)이 **남지 않게** idle로 정리. `hudProgressRef`(이번 턴에 progress를 띄웠는지) 같은 ref로 턴 종료 시 `if(아직 generating) setHud(idle)`. jsx=null이면 idle + `message`(예: '이 작업엔 HUD가 필요 없습니다')도 고려(단 현재 `HudEmpty`는 message 미표시 — 표시하려면 같이 손볼 것).

**6) 탭 전환** — 진행 중 강제 `setTab('hud')`는 하지 말 것(모바일에서 usher 챗 ack를 가림). 데스크톱은 두 패널이 동시에 보여 라이브 진행이 즉시 보인다. 모바일은 상태바 + 기존 완성 시 `setTab('hud')`로 충분.

**7) (선택) 인자/출력 델타 강화** — SSE가 `response.function_call_arguments.delta`(또는 유사)로 명령을 토큰 단위로 흘리면, `streamResponse`/`readToolEvent`(lib/hermes.ts)를 확장해 인자를 누적·표시하면 로그가 더 풍부해진다. **0)에서 필드 확인 후** 가치 있으면 진행.

## 제약 (AGENTS)

- 진행 HUD는 **디자인 토큰·허용 프리미티브만**(손제작이라 스코프 강제는 자동이지만 토큰 일관 유지).
- **수치·로그는 도구 출력 원문**만(정제=트렁케이트/첫 줄). LLM이 지어내지 않는다.
- 키 프론트 미노출. 외부 라이브러리 추가 금지(필요하면 먼저 물을 것).
- 본 generative HUD(iframe 샌드박스·자기치유)는 **그대로** — 이건 그 *앞단* 진행 표시일 뿐, 샌드박스 경로를 건드리지 말 것.

## 검증 (완료 선언 전, 네가 먼저 통과)

```
cd web
npm run typecheck && npm run lint && npm run test && npm run build
```
- 도구 쓰는 질문(디스크/깃 상태 등): HUD가 **즉시 generating+타임라인**으로 차고, 각 도구 done 시 스텝이 done, 본 HUD 완성 시 **교체**.
- 도구 **안 쓰는** 질문: 진행 HUD 안 뜸(기존대로 idle/이전 상태).
- **잔상 없음:** jsx=null/에러/중단/새 대화 후 generating(activity)이 idle로 정리.
- **환각 없음:** detail은 도구 출력 그대로(트렁케이트). 추출 실패 시 타임라인만.
- 새 단위 테스트: `extractToolDetail`(다양한 item 모양 → 기대 detail/undefined). 가능하면 활동 누적 로직도.

## 파일 (예상)

- `web/src/components/HudCanvas.tsx` — `HudRenderState.activity?`; `generating` 분기에서 activity 있으면 `HudProgress`; `HudProgress` 컴포넌트(Panel+StatusPanel+Steps).
- `web/src/App.tsx` — `ToolActivity` 모델, `handleToolEvent` 확장, `hudProgressRef` 수명관리, `extractToolDetail`.
- `web/src/lib/hermes.ts` — (선택) 인자 델타 surface.
- `web/src/styles/app.css` — 필요 시 progress 미세 스타일.
- `scripts/hermes_responses_spike.py`(또는 임시) — 0) SSE 필드 캡처.
- 테스트: `web/src/lib/*.test.ts`(extractToolDetail 등).

---

## 붙여넣기용 프롬프트 (패턴 A)

```
[맥락] AGENTS.md, docs/기획서.md, docs/briefs/hud-tool-activity-handoff.md를 먼저 읽어.
       generative HUD 자비스에서, envelope 턴이 도구를 도는 동안 HUD 캔버스가 비어 있어
       사용자가 그냥 기다린다. 이걸 "도구 실행 타임라인 + 정제 로그" 라이브 표시로 채운다.
       HudCanvas엔 이미 generating 페이즈(HudSkeleton)가 있고, 메인 스트림은 onToolEvent로
       도구 call/output을 흘린다(지금은 상태바만 씀).
[목표] 브리프의 "설계" 1~6을 구현. 진행 HUD는 손제작 컴포넌트로 HudFallback처럼 직접 렌더
       (iframe 샌드박스 불필요). 0) 먼저 Hermes SSE의 도구 item 실제 필드를 한 번 캡처해
       확인한 뒤 정제기를 짜라(추측 금지). detail은 도구 출력 원문만 트렁케이트.
[제약] 디자인 토큰·허용 프리미티브만. 수치/로그 LLM 생성 금지. 본 generative HUD 샌드박스
       경로는 건드리지 마라. 외부 라이브러리 추가는 먼저 물을 것. 진행 중 강제 탭전환 금지.
[검증] 브리프의 "검증"을 네가 먼저 통과(typecheck/lint/test/build + 동작·잔상·환각 체크)하고
       결과를 보고. extractToolDetail 단위 테스트 추가.
[출력] feature/hud-tool-activity 브랜치, 작은 커밋. 변경 요약 + 검증 로그 + 0)에서 관측한 SSE 필드 보고.
```
