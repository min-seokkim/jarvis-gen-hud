# AGENTS.md — jarvis-gen-hud

> 이 저장소에서 코딩 에이전트(주로 **Claude Code**)가 작업할 때 **가장 먼저 읽는 기준 문서.**
> 사람의 작업 흐름·프롬프트 패턴 → `docs/agent-workflow.md` · 기획 → `docs/기획서.md` · 설계 배경 → `jarvis_handoff.md`.

## 프로젝트
아이언맨의 자비스를 현실에 만든다. 음성으로 대화하고, 작업 맥락에 맞는 UI(HUD)를 LLM이 **실시간 생성**하는 React 프론트엔드. **평가 대상이자 0부터 짓는 유일한 부분 = Generative HUD.** 두뇌(Hermes)·음성·도구 합성은 위임한다.

## 불변 원칙 (어기지 말 것)
- **0부터 짓는 건 generative HUD 하나.** 그 외는 기존 완성형을 갖다 쓴다.
- **계산은 deterministic 코드/도구가, LLM은 오케스트레이션만.** 숫자·계산을 지어내지 않는다.
- **생성 UI는 디자인 토큰·허용 컴포넌트 스코프만 사용** (자유 생성 + 디자인 언어 제약).
- **음성 즉답은 클라우드 임계경로에 두지 않는다** (빠른 메인이 즉답/usher, HUD 생성은 병렬).
- **비밀(키)은 프론트/커밋에 절대 노출 금지.**

## 저장소 구조
- `web/` — React 앱 (2주차부터)
- `orchestrator/` — 라이브 HUD 소스 오케스트레이터 (Python: `/sources` descriptor + `/ws` 라이브 푸시)
- `deploy/` — 배포 (docker-compose, Caddyfile, .env.example)
- `docs/` — 기획서·agent-workflow·회고 (GitHub Wiki와 동기화)
- `jarvis_handoff.md` — 설계 배경·논리
- `AGENTS.md`(이 파일) · `CLAUDE.md` — 에이전트 진입 문서

## 기술 스택 (요약)
React(Vite + TS) · HUD: 제약 JSX 샌드박스(react-live/Sandpack, iframe 격리, 자기치유) · 두뇌: **단일 Hermes Agent**(OpenAI 호환 API), **역할 하이브리드**(빠른 메인 Haiku4.5/GPT-5.4-mini = 음성·즉답·dispatch + 강한 delegation Opus4.6/GPT-5.5 = 추론; 프로바이더 OpenAI·Anthropic만) · 음성: faster-whisper(STT, 로컬) + ElevenLabs(TTS), 오케스트레이터(워크스테이션 Python)가 `/v1` 병렬 멀티플렉싱 — **로컬 LLM(Qwen/Ollama) 없음**.

## 연결 사실 (중요)
- 프론트는 **같은 출처** `/v1/responses`(OpenAI Responses API, SSE 스트리밍)로 Hermes를 호출한다.
- **"OpenAI 호환"은 규격을 뜻한다 — OpenAI사 호출이 아니다.** 이 `/v1` 엔드포인트는 **Hermes가 띄운 로컬 API 서버**(`localhost:8642`)이며, OpenAI API와 같은 형식이라 OpenAI용 클라이언트/SDK를 그대로 붙일 수 있다는 의미일 뿐이다. (혼동 주의: 두뇌=클라우드 모델이 현재 OpenAI사인 것과 **별개**. 두뇌를 Claude 등으로 바꿔도 이 API 서버는 계속 OpenAI 호환.)
- **API 키를 프론트에 넣지 않는다.** Caddy가 서버측에서 `Authorization` 헤더를 주입하고 사이트를 basic-auth로 게이트한다.
- 모델 호출부는 모델 무관하게 추상화 (프로바이더 교체 가능).

## 작업 방식
- 작업은 **기능 단위**(데모 가능한 수직 슬라이스) 또는 **컴포넌트 단위**로. 한 번에 하나.
- 브랜치: `main → dev → feature/*`. **한 PR = 한 기능.** 커밋 메시지에 `#이슈번호`.
- 낯선 기능은 throwaway 스파이크로 "되는가"만 먼저 검증.
- TypeScript. **외부 라이브러리 임의 추가 금지** (필요하면 먼저 물어볼 것).
- 수정은 가능한 한 패치(diff)로. 불확실하면 "모른다"고 말하고 근거를 단다. 추측으로 API·숫자를 지어내지 않는다.

## 명령 (`web/` 스캐폴딩 후 갱신)
```
npm install        # 설치
npm run dev        # 개발 서버
npm run build      # 프로덕션 빌드
npm run typecheck  # 타입 검사
npm run lint       # 린트
```

## "완료" 선언 전 자가 검증
- 빌드/타입 통과(에러 0), 실제 렌더/실행 확인, 에러 경계 동작.
- **HUD:** 디자인 토큰·허용 컴포넌트만 사용 / iframe 격리 / 자기치유 재시도 cap·폴백 / 본 적 없는 작업에 새 HUD 생성.
- **보안:** 키 프론트 미노출, TLS·basic-auth, `0.0.0.0` 직노출 없음.
- 상세 체크리스트 → `docs/agent-workflow.md` §3.
