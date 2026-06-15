# 프론트 음성 흔적 정리 — Claude Code 핸드오프 브리프

> 스펙 = Cowork. **구현·검증 = Claude Code.** 근거: `docs/decisions/0004-descope-voice.md`(음성 범위 제외). 브랜치 제안: `feature/voice-trace-cleanup` → `dev` PR.

## 목표

음성을 범위에서 제외(ADR 0004)했으니, **프론트가 잘라낸 기능을 광고하지 않게** 음성 흔적을 비노출 정리한다. 데모/평가에서 "이건 왜 안 되지?"를 없앤다. 코어(텍스트 → HUD)·Live HUD·usher는 **건드리지 않는다.**

## 정리 대상 (관측)

- `web/src/components/InputBar.tsx` L43–46 — 마이크 버튼(`className="mic"`, `title="음성 입력 (M5)"`, `aria-label="음성 입력 (준비 중)"`). **제거**(또는 완전 숨김). 입력창/전송 레이아웃·동작 안 깨지게.
- `web/src/styles/app.css` L413 — `.input-bar .mic { … }`. 버튼 제거 시 같이 제거.
- `web/src/types.ts` L11 — `JarvisStatus`의 `'listening'`(자리만). **제거**.
- `web/src/components/StatusBar.tsx` L5 — `listening: '청취'` 매핑. `'listening'` 제거에 맞춰 같이 제거(상태 라벨 맵이 union을 exhaustive하게 다루면 타입 에러 안 나게).
- `web/src/Gallery.tsx` L377 — `label="Voice envelope"`. **확인만**: 이건 say/envelope(자비스 발화 텍스트) 데모 라벨이지 음성 I/O가 아님 → 무관하면 유지하거나, 오해 소지 있으면 라벨만 "Say envelope" 등으로 정리.

## 유지 (잘라내지 말 것)

- **usher 즉답**(`lib/hermes.ts`의 `streamUsher`, `store:false`) — 텍스트 TTFT. 유지.
- **Live HUD 오케스트레이터/WS**(`lib/liveHud.ts`, `orchestrator/`). 음성 아님 — 생성형 HUD의 라이브 데이터 채널. 유지.
- `JarvisStatus`의 나머지 상태(idle/thinking/tooling/rendering/caution/warning). 유지.

## 제약

- 코어 흐름(텍스트 입력 → `/v1/responses` → HUD) **불변**. 외부 라이브러리 변화 없음.
- `'listening'` 제거 시 이를 참조하는 **모든 곳**(StatusBar 매핑, 혹시 다른 switch/맵/테스트) 동기화 → 타입체크 그린.
- 음성 관련 docs/브리프(M5 등)는 삭제하지 말 것(ADR 0004대로 future work 기록 보존).

## 검증 (완료 선언 전)

```
cd web
npm run typecheck && npm run lint && npm run test && npm run build
```
- 앱에 **마이크 버튼 없음**, 상태바에 '청취' 라벨 없음, 입력/전송 정상.
- grep 클린: `grep -rinE "listening|\.mic\b|음성|whisper|eleven" web/src` → 음성 흔적 0(또는 무관한 것만 남음).
- 텍스트 명령 → HUD 생성 정상(회귀 없음).

---

## 붙여넣기용 프롬프트 (패턴 A)

```
[맥락] AGENTS.md와 docs/decisions/0004-descope-voice.md, docs/briefs/voice-trace-cleanup-handoff.md를
       먼저 읽어. 음성(STT/TTS)을 이번 범위에서 제외했다(ADR 0004). 프론트에 남은 음성 흔적이
       잘라낸 기능을 광고하지 않게 비노출 정리한다. 코어(텍스트→HUD)·Live HUD·usher는 건드리지 마라.
[목표] (1) InputBar 마이크 버튼(L43–46)과 app.css .input-bar .mic 제거,
       (2) JarvisStatus의 'listening'(types.ts) + StatusBar의 'listening' 매핑 제거(참조처 동기화),
       (3) Gallery 'Voice envelope' 라벨은 say/envelope 데모라 음성 I/O 아님 — 확인 후 오해 소지면 라벨만 정리.
[제약] 텍스트 입력→/v1/responses→HUD 흐름 불변. usher(streamUsher, store:false)·liveHud·orchestrator 유지.
       외부 라이브러리 변화 없음. 음성 docs/브리프는 삭제 금지(future work 기록 보존).
[검증] typecheck/lint/test/build 그린 + 앱에 마이크 버튼/'청취' 라벨 없음 + grep로 음성 흔적 0 +
       텍스트→HUD 회귀 없음. 결과/로그 보고.
[출력] feature/voice-trace-cleanup 브랜치, 작은 커밋. 변경 요약 + 검증 로그.
```
