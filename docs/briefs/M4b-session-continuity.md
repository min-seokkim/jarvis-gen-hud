# M4b 빌드 브리프 — 세션 연속성 (stateless 탈출 · /v1/responses 전환)

> Cowork 작성 · Claude Code 핸드오프. refine 단계 — **우선순위 전제: 데모 리스크보다 제품 완성도**(사용자 결정 6/11: 라이브 데모 실패 허용, 백업은 녹화 1본이면 충분 — 현 상태로 이미 가능).
> 선행: M3 완료. **M4(envelope)와 같은 transport를 쓰므로 M4 구현 전 또는 함께** 진행 권장 — S1 스파이크를 `/v1/responses` 대상으로 돌리면 이중작업이 없다.
> 근거: Hermes API 서버 공식 문서(아래 출처). 브랜치: `feature/session-continuity` → `dev` PR.

## 문제 (현 상태)

프론트가 `/v1/chat/completions`(공식 stateless)로 **매 요청 전체 이력을 재전송**하고, Hermes는 요청마다 독립 AIAgent를 띄운다. 결과: ① 이전 턴의 **도구 호출·결과가 다음 턴에 안 보임**(M4 envelope가 도구를 돌리기 시작하면 "아까 그거 다시 보여줘"가 불가능), ② 새로고침 시 대화 소실, ③ 대시보드 세션 파편화, ④ 이력 재전송으로 토큰 낭비.

## 목표 (Exit)

한 대화가 **Hermes 서버측에 도구 맥락 포함으로 보존**된다. 프론트는 마지막 입력만 전송. "방금 뭐 실행했지?" 류 후속 질문이 이전 턴의 도구 결과를 참조해 답한다. 도구 진행 상황이 상태바에 표시된다.

## 설계 (Hermes 네이티브 기능 사용)

`POST /v1/responses` + **named conversation**:

```json
{ "model": "hermes", "input": "...", "conversation": "jarvis-<생성시각>", "store": true, "stream": true }
```

- 서버가 해당 conversation의 최신 응답에 자동 체이닝 — **이전 도구 호출·결과 포함 전체 맥락 복원**. SQLite 영속(게이트웨이 재시작 생존).
- 스트림 이벤트: `response.output_text.delta`(텍스트), **`function_call` / `function_call_output` output item**(도구 진행 — 구조화), `response.completed`.
- OpenAI Responses 규격이므로 "OpenAI 호환 추상화" 원칙 유지(프로바이더 교체 가능성 보존).

## 범위

1. **`lib/hermes.ts` v2** — `/v1/responses` SSE 클라이언트: `streamResponse(input, conversation, options)` → 텍스트 델타 yield + 도구 이벤트 콜백(`onToolEvent`). 기존 `streamChat`은 마이그레이션 완료 후 제거.
2. **App 상태** — `messages` 이력 재전송 제거(표시용으로만 유지), conversation 이름 생성·보관(localStorage). **"새 대화" 버튼**: 새 conversation 이름 발급(자비스 페르소나 SOUL 재로드 트리거 겸용 — 운영 메모와 정합).
3. **도구 진행 표시** — `function_call` 이벤트 → StatusBar `thinking` 세분화("도구 실행 중: terminal") + HudCanvas 스켈레톤 유지. `types.ts`의 `JarvisStatus`에 상태 추가 검토.
4. **HUD 턴 합류 (M4 정합)** — envelope 턴도 같은 transport로. **D1 참조.**
5. **새로고침 복원 (stretch)** — 표시용 transcript를 localStorage 캐시(서버 맥락은 conversation이 이미 보존하므로 표시만 복원하면 됨).
6. **프록시 확인** — Vite/Caddy의 `/v1/*` 매처가 `/v1/responses`를 이미 커버하는지 1회 확인(커버함이 정상 — 확인만).

## 결정 필요

- **D1 — HUD 턴의 conversation 소속:** ① 대화와 **같은** conversation(HUD가 대화 맥락을 알아 "아까 그 디스크" 가능, 단 envelope JSON이 대화 이력에 쌓임 — 후속 턴 혼란 가능성) vs ② **별도** conversation(이력 깨끗, 맥락은 task 문자열로만 전달). 권장 ① — 자비스다움이 목적이고, envelope의 `say`가 이력상 자연스러운 발화 역할을 함. 스파이크에서 오염 여부 확인 후 확정.
- **D2 — `conversation` vs `previous_response_id` 수동 체이닝:** conversation이 단순(서버가 체이닝)·권장. response_id 추적은 분기(fork) 필요해질 때만.

## 제약·리스크

- **stored responses LRU 100개** — 긴 세션에서 오래된 턴 증발 가능. 대응: "새 대화"로 주기 회전 + 한 세션 100턴 미만 가정(데모·일상 사용 충분). 임계면 Sessions API(`/api/sessions`)로 후속 이전.
- 이벤트 파싱이 chat.completions와 달라 **mock e2e 전면 갱신** 필요(M3 e2e의 `sse()` 헬퍼를 Responses 형식으로).
- `model` 필드는 cosmetic(서버 config가 실제 모델 결정) — 기존 `VITE_HERMES_MODEL` 의미 약화, 정리.

## 검증 (완료 선언 전)

- 멀티턴: 턴1 "디스크 사용량 봐줘"(도구 실행) → 턴2 "방금 어느 볼륨이 제일 찼었지?" → **재실행 없이** 이전 결과 참조 답변.
- 새로고침 → conversation 유지(이어서 질문 가능), (stretch) transcript 표시 복원.
- 도구 실행 중 상태바에 진행 표시, 완료 시 정상 복귀.
- "새 대화" → 맥락 단절 확인(이전 대화 참조 안 됨).
- `npm run build`/`typecheck`/`lint` 0 · e2e(Responses mock) 통과.

## 출처

- [API Server — /v1/responses, named conversations, 스트림 이벤트, LRU 100, Sessions API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)

---

### Claude Code에 붙여넣을 프롬프트

```
[맥락] AGENTS.md, docs/briefs/M4b-session-continuity.md, docs/briefs/M4-hud-invention.md를 먼저 읽어.
       현 프론트는 /v1/chat/completions stateless(이력 재전송). 이를 /v1/responses + named conversation으로 전환해
       서버측 대화·도구 맥락 보존을 얻는다. M4 envelope 턴도 같은 transport를 쓴다.
[목표] (1) lib/hermes.ts를 /v1/responses SSE 클라이언트로 재작성(텍스트 델타 + function_call 도구 이벤트 콜백)
       (2) App: 이력 재전송 제거, conversation 이름 localStorage 관리, "새 대화" 버튼
       (3) 도구 진행 → StatusBar 표시 (4) 새로고침 transcript 복원(stretch)
       (5) e2e mock을 Responses 이벤트 형식으로 갱신
[제약] TS. 외부 라이브러리 추가 금지. 키 프론트 미노출 유지(프록시 경유 — /v1/* 매처 확인만).
[결정] D1(HUD 턴 conversation 공유 여부)·D2(conversation vs previous_response_id) — 장단점 1줄씩 제시 후 택1. (권장: 공유·conversation)
[출력] feature/session-continuity 브랜치 작은 커밋들. 멀티턴 도구 맥락 참조 시연 로그 + 검증 체크리스트 통과 보고.
```
