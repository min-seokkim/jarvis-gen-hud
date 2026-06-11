# M4c — 단일 자아 (자비스에는 세션이 없다)

> Cowork 작성 · Codex 핸드오프. 아래 프롬프트를 그대로 붙여넣는다.
> 배경: M4b가 `/v1/responses` + named conversation까지는 갔으나, ① 채팅/HUD가 별도 conversation(`-hud`)의 두 자아로 갈라져 있고 ② 장기 기억 스코프가 conversation별로 파편화되며 ③ conversation 무한 체이닝은 LRU 100으로 조용히 무너진다. 목표 = "세션 없는 자비스": 한 발화 = 한 턴(단일 저자), 기억은 인물 단위로 고정.

---

```
[맥락] AGENTS.md, docs/briefs/M4-hud-invention.md, M4b-session-continuity.md를 먼저 읽어.
       그 위에서 이번 작업의 문제 진단과 해결을 아래에 명시한다. 평가 기준은 "자비스에는 세션이 없다" —
       사용자는 하나의 연속된 인격과 대화하고 있어야 한다.

[현재 문제 — 코드 근거 포함]

P1. 자아 분열 (가장 심각).
    App.tsx의 handleSend가 한 발화에 대해 ① streamResponse(채팅 턴, conversation)와
    ② startHudGeneration(HUD 턴, hudConversationName() = `${conversation}-hud`)을 따로 발사한다.
    → 같은 발화를 두 에이전트가 독립 처리: 채팅 자아는 HUD 자아가 돌린 도구를 모르고(후속 질문
    "아까 그 디스크 어땠지?"가 채팅 쪽에선 불가), 둘 다 도구를 돌려 중복 실행·답변 발산 가능.
    분리한 이유는 짐작한다 — Hermes는 세션당 턴이 직렬이라(#1468) 같은 conversation에 병렬 두 턴을
    던지면 줄을 서게 된다. 하지만 근치는 분리가 아니라 "한 발화 = 한 턴"이다.

P2. 장기 기억 파편화.
    어떤 /v1 호출에도 X-Hermes-Session-Key 헤더가 없다. Hermes의 장기 메모리 스코프는 키가 없으면
    세션/conversation 단위로 갈라진다 → `-hud` 자아와 채팅 자아의 기억이 다른 서랍에 쌓이고,
    "새 대화"를 누르면 기억 서랍이 통째로 바뀐다. 자비스가 세션이 없는 이유는 기억이 "인물 단위"라서다.

P3. conversation 무한 체이닝의 조용한 붕괴 + 새로고침 시 HUD 증발.
    stored responses는 LRU 100개 — 영구 conversation은 오래 쓰면 옛 턴이 소리 없이 증발한다.
    또 새로고침 시 transcript는 localStorage로 복원되지만 HUD는 idle로 사라진다.

[해결 — 우선순위 순]

F1. 고정 세션 키 (즉효, 작은 diff).
    모든 /v1 호출(채팅·HUD·repair 포함)에 헤더 X-Hermes-Session-Key: jarvis:main 을 추가한다.
    (env VITE_JARVIS_SESSION_KEY로 오버라이드 가능, 기본 'jarvis:main'. 256자 제한·제어문자 금지 준수.)
    효과: conversation이 회전해도 장기 메모리는 한 인물로 연속된다.

F2. 단일 저자 통합 — 채팅/HUD 이원 호출 폐지.
    한 발화 = conversation 하나에 envelope 턴 하나. hudConversationName()과 `-hud` conversation 삭제.
    envelope 키 순서는 이미 say→design→data→jsx로 강제돼 있다. 이를 이용해:
    - 스트리밍 중 "say" 문자열 값을 증분 파싱해(이스케이프 처리 포함) 토큰처럼 대화 패널에 흘린다.
      say가 닫히면 이후(design/data/jsx)는 버퍼링하고 상태를 rendering으로.
    - 응답이 '{'로 시작하지 않으면 전체를 일반 텍스트 답변으로 스트리밍(비-envelope 폴백,
      기존 shouldBufferPotentialEnvelope/extractEnvelopeSay 로직은 이 폴백으로 흡수·정리).
    - 완성된 envelope은 기존 파이프라인 그대로: assertValidHudEnvelope → 렌더 → 자기치유 cap2 → 폴백.
      jsx:null이면 HUD 미표시. live 필드·LiveHudClient 구독(M5a) 경로 불변.
    - CHAT_SYSTEM_PROMPT와 HUD_SYSTEM_PROMPT를 단일 instructions로 병합한다(페르소나는 SOUL이 담당,
      instructions에는 envelope 계약 + project root + "짧은 say, 디테일은 HUD" 행동 규칙만).
      "Never output HUD JSON envelopes in the chat channel" 류의 이원화 지시는 통합과 함께 제거.

F3. conversation = 단기 작업 맥락으로 격하 + HUD 영속.
    - 연속성의 주체는 F1의 세션 키 + Hermes 장기 메모리. conversation은 LRU 안전을 위해 회전 가능한
      단기 맥락이다: transcript가 N턴(기본 40)을 넘으면 다음 발화부터 새 conversation으로 조용히 회전
      (사용자에게 알리지 않음 — 자비스는 세션 전환을 티 내지 않는다).
    - "새 대화" 버튼은 유지하되 의미는 "화제 전환"(conversation 회전 + transcript 클리어)이며,
      기억은 세션 키로 지속됨을 코드 주석에 명시.
    - 마지막 렌더 HUD {jsx, design, data, live}를 localStorage에 저장, 새로고침 시 phase:'rendered'로
      복원하고 live가 있으면 재구독한다.

[결정 필요 — 장단점 1줄씩 제시 후 택1하고 진행]
D1. envelope 턴 적용 범위: (a) shouldGenerateHud 휴리스틱 통과 시에만 envelope instructions,
    그 외엔 일반 대화 턴 vs (b) 항상 envelope(모델이 jsx:null로 화면 불필요를 판단, 휴리스틱 삭제).
    권장 (b) — 트리거 오발동·미발동 문제 자체가 소멸하고 비-envelope 폴백이 안전망.
D2. 자기치유 repair 턴: (a) 같은 conversation(맥락 보존, 단 repair 지시가 이력에 쌓임) vs
    (b) conversation 없는 stateless 호출(이력 청결, repair에 기억·도구 불필요). 권장 (b).
D3. say 증분 파서 실패(비정형 스트림) 시: 버퍼 전체를 폴백 텍스트로 출력 — 절대 빈 말풍선/크래시 금지.

[제약]
- TS. 프론트 외부 라이브러리 추가 금지(증분 파서는 직접 작성 — 정규식 아닌 문자 단위 상태기 권장).
- 검증 게이트(assertValidHudEnvelope/assertValidHudJsx)·자기치유 cap·폴백은 완화 금지(추가만 가능).
- M5a 라이브 채널(liveHud.ts, live 필드) 회귀 0. 키 프론트 미노출 유지.
- 한 발화당 /v1 요청은 정확히 1회여야 한다(repair 제외) — 네트워크 탭으로 확인.

[검증 — 완료 선언 전 네가 먼저 통과시켜라]
1. "디스크 사용량 봐줘" → say가 토큰처럼 흐르고, 이어 같은 턴의 HUD가 뜬다. /v1 요청 1회.
2. 후속 "방금 어느 볼륨이 제일 찼었지?" → 같은 conversation에서 도구 재실행 없이 이전 결과 참조.
3. 잡담("안녕") → jsx:null, HUD 변화 없음, 답변 자연 스트리밍.
4. "새 대화" 후 이전 대화의 개인적 사실을 질문 → 장기 메모리로 회상되는지 수동 확인
   (메모리 기록은 비동기라 플레이키할 수 있음 — 결과를 보고에 기록만 해도 됨).
5. 새로고침 → transcript + HUD 복원, live HUD면 재구독 후 갱신 재개.
6. 40턴 초과 시 conversation 회전이 일어나고 사용자 체감 단절이 없는지.
7. 비-envelope 응답 폴백, 깨진 envelope → 자기치유/폴백, 앱 안 죽음. 기존 e2e 갱신 + 신규 1본
   (say 증분 스트리밍 mock). npm run build/typecheck/lint 0.

[출력] feature/single-self 브랜치 작은 커밋들. 검증 1·2·5 시연 로그/스크린샷 + 체크리스트 통과 보고.
D1~D3 선택과 근거 1줄씩 보고에 포함.
```
