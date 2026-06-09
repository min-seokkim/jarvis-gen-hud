# M5 빌드 브리프 — 하이브리드 음성 라우팅 (로컬 즉답 + 클라우드 HUD)

> ⚠️ **SUPERSEDED (이 브리프의 '음성=로컬 Qwen' 설계는 폐기).** 확정 = **단일 Hermes 브레인 + 역할 하이브리드**(빠른 메인=음성·즉답·dispatch, 강한 delegation=추론). 로컬 LLM(Qwen/Ollama) 안 씀. 근거: `docs/decisions/0001-0003`, [[hybrid-routing]] 메모리. 아래 본문의 '로컬 Qwen 라우터/Ollama/출력양식 라우팅'은 **역사적 기록**일 뿐 — 오케스트레이터(STT·TTS·`/v1` 멀티플렉싱)와 "음성 즉답을 클라우드 임계경로에 두지 않는다"는 원칙만 유효. S0 스파이크는 `hermes_spike.py`로 이미 수행됨.

> Cowork 작성 · Claude Code 핸드오프. **AGENTS.md 준수.**
> 브랜치: `feature/voice-orchestrator` → `dev` PR.
> 선행: M1 앱 셸 + Hermes `/v1` 스트리밍(완료) · Hermes SOUL 페르소나(완료, `deploy/hermes/`). (M0 음성 스모크 스크립트 `voice_smoke_test.py`는 제거됨 — S0에서 스파이크를 새로 작성한다.)

## 목표 (Exit 조건)

마이크로 말하거나 텍스트로 명령하면 **자비스 음성 즉답이 로컬 경로로 먼저 재생되고, 동시에 화면 작업(HUD·추론)은 클라우드 Hermes로 병렬 처리**된다. 음성은 클라우드 임계경로에 묶이지 않는다. 첫 소리까지 지연(TTFA/TTFT)을 실측한다.

## 설계 한 줄

**출력 양식 기반 라우팅 — 음성 = 로컬(TTFT), 화면·추론·HUD = 클라우드(능력). 두 경로 병렬.** (음성만 답하면 일반 음성비서로 보인다 → HUD가 *동시에* 떠야 우리 알맹이가 데모에 나온다.)

## 아키텍처

브라우저는 **오케스트레이터 하나하고만** 말한다(단일 front door). 오케스트레이터가 STT·라우팅·로컬 즉답·TTS를 처리하고, 화면이 필요하면 Hermes를 **server-side로** 부른다. 모든 키(Hermes·ElevenLabs·모델 프로바이더)는 서버측에만 둔다.

```
[노트북 브라우저 — React 얇은 클라이언트]
   │  ▲ mic 오디오(WebAudio) / 텍스트  ──WS──▶
   │  │ ◀── voice 오디오 청크 (TTS)
   │  │ ◀── HUD JSX delta / transcript / status
   ▼  │
[워크스테이션 — 오케스트레이터 (Python, FastAPI + websockets, asyncio)]
   ├─ STT      faster-whisper (GPU, float16)         부분/최종 transcript
   ├─ Router   로컬 Qwen (Ollama)   ──▶ {say_now, needs_screen, screen_brief}
   │     └─(음성 경로, 로컬·빠름) say_now ─▶ ElevenLabs TTS 스트리밍 ─▶ 브라우저   ◀ TTFT 경로
   └─(화면 경로, needs_screen일 때 병렬)
         Hermes /v1 (클라우드, SSE) ─▶ 추론 + 제약 JSX 스트리밍 ─▶ 브라우저 HUD 캔버스 (M3 합류)
```

GPU 예산(RTX 4080 Super 16GB): faster-whisper(small/medium) + Qwen 7B(q4) 공존 ≈ 10–12GB. TTS는 클라우드라 GPU 미사용.

### 데이터 흐름

1. **입력** — 브라우저가 mic 오디오 또는 텍스트를 WS로 전송.
2. **STT**(텍스트면 skip) — faster-whisper, 부분/최종 transcript. `listening` 상태.
3. **라우터**(로컬 Qwen) — 구조화 출력 `{intent, say_now, needs_screen, screen_brief}`. 작고 빠르게.
4. **병렬 fan-out**
   - **음성 경로(로컬):** `say_now` → ElevenLabs 스트리밍 → 오디오 청크 즉시 push. **클라우드를 기다리지 않는다.**
   - **화면 경로(클라우드, `needs_screen`):** `screen_brief`로 Hermes `/v1` SSE 호출 → 추론 + 제약 JSX 스트리밍 → HUD delta push.
5. **출력** — 브라우저가 오디오 재생 + HUD 렌더를 *동시에*.

### 컴포넌트 / 스택 (추천)

- **STT:** faster-whisper `small`(또는 `medium`), cuda, float16.
- **로컬 LLM 서빙:** **Ollama** 권장 — OpenAI 호환 `/v1` 제공, 스트리밍, 셋업 최소. 모델 시작점 **Qwen2.5-7B-Instruct**(한국어 강함) q4_K_M. *업그레이드 경로:* 측정상 TTFT/동시성 부족하면 vLLM. *후속 분리:* 라우팅 분류는 더 작은 모델(예: 3B)로 빼 지연을 더 줄일 수 있음.
- **라우터 프롬프트:** SOUL.md 압축본을 공유해 `say_now`가 Hermes와 **같은 자비스 보이스**가 되게. (스모크 테스트의 "You are JARVIS. Reply in ONE short sentence…"의 확장.)
- **TTS:** ElevenLabs Flash v2.5 multilingual, 스트리밍(첫 청크 TTFA가 체감 지연 핵심).
- **클라우드:** 기존 Hermes `/v1`(페르소나 = SOUL.md). 오케스트레이터가 server-side 호출, `lib/hermes.ts`의 SSE 파싱 로직과 동형.
- **오케스트레이터:** Python(FastAPI + websockets), 워크스테이션(GPU 접근). asyncio로 두 경로 동시.

### 라우팅 로직 (출력 양식 기반)

라우터가 매 발화를 분류한다:

- **voice_only** — 짧은 사실·대화 → 로컬 음성만.
- **needs_screen** — 데이터·진행·신호·상태·비교 → 로컬은 짧은 **framing 음성**("빌드 상태 띄우겠습니다"), 클라우드가 HUD.
- **both** — 음성 요약 + HUD 디테일.

원칙: 음성은 *항상* 로컬에서 즉시. 무거운 추론·정확한 수치·시각화는 클라우드. **`say_now`는 클라우드 결과를 기다리지 않는다.** 일관성: screen-heavy면 로컬 음성은 framing만 말하고, 권위 있는 디테일은 HUD의 deterministic 데이터에 둔다(로컬이 수치를 지어내지 않게).

### 인터페이스 — WS 프로토콜 (초안)

client → server
- `{type:"text", content}` · (binary audio frames) + `{type:"audio_end"}` · `{type:"cancel"}`

server → client
- `{type:"status", state:"listening|thinking|speaking|rendering|idle|warning"}` — `types.ts`의 `JarvisStatus`와 정렬(speaking 추가 검토)
- `{type:"transcript", text, final}`
- `{type:"voice.delta", audio}` / `{type:"voice.end"}`
- `{type:"say", text}` — 음성 대사 텍스트도 대화 패널에 표시
- `{type:"hud.delta", jsx}` / `{type:"hud.end"}` — **M3 HUD와 합류**
- `{type:"error", message}`

orchestrator ↔ Hermes: 기존 `/v1/chat/completions` SSE, `Authorization` 서버측 주입.
orchestrator ↔ Ollama: `/v1/chat/completions`(OpenAI 호환) 또는 `/api/chat`, 스트리밍.

## 단계 (de-risk 먼저, 한 PR = 한 단계)

- **S0 — 스파이크(선행, 버릴 코드):** 스파이크를 새로 작성한다(M0 `voice_smoke_test.py`는 제거됨). 같은 입력으로 (a) 로컬 즉답 TTS와 (b) Hermes `/v1` 호출을 asyncio로 **동시에** 띄워, 음성 첫 소리 TTFA와 HUD 첫 토큰 시각을 각각 찍는다. **Exit:** "음성이 클라우드와 무관하게 먼저 난다"를 숫자로 증명.
- **S1 — 오케스트레이터 골격:** WS 서버 + 텍스트 입력 → 라우터 → fan-out(로컬 음성 + 조건부 Hermes). STT 없이 텍스트부터. 브라우저(InputBar mic 활성화는 S2) 얇은 클라이언트 연결.
- **S2 — STT:** faster-whisper로 음성 입력. `listening` 상태, VAD·발화종료 감지.
- **S3 — 스트리밍 중첩:** STT 부분결과 → 라우터 → TTS 청크를 겹쳐 흘려보내 TTFT 0.5s 추격.

## 결정 필요 / 열린 것

- 라우터: 단일 모델 구조화 출력 vs 분류기+생성기 분리. → 시작은 단일, 측정 후 분리.
- `say_now` 깊이: 단순 ack vs 로컬의 실제 짧은 답. → 기본은 짧은 실답, screen-heavy면 framing.
- WS 오디오 포맷: `pcm_24000` raw(스모크와 동일) vs opus(대역폭). → 시작 pcm.
- 원격(노트북) WAN 홉 지연 → localhost **및** 터널 너머 둘 다 측정(M0 메모).

## 제약 (AGENTS.md 불변 원칙)

- **음성 즉답을 클라우드 임계경로에 두지 않는다.**
- **계산·수치는 deterministic 도구/코드** — 로컬·클라우드 LLM 모두 숫자를 지어내지 않는다.
- **키(Hermes·ElevenLabs·프로바이더) 프론트 미노출** — 오케스트레이터 서버측에만.
- 외부 라이브러리 추가는 먼저 묻기(음성용 FastAPI·websockets·faster-whisper·elevenlabs는 합의 범위로 제안). 프론트 TypeScript, 오케스트레이터 Python.
- `0.0.0.0` 직노출 금지. Caddy/TLS/basic-auth 게이트 유지 — **WS도 Caddy가 프록시**(`/ws`), `/v1`은 가능하면 외부 비공개(오케스트레이터만 내부 호출).

## 검증 (완료 선언 전)

- TTFA(첫 소리) 실측 — localhost **및** 터널 너머, 목표 0.5s까지 거리.
- 음성과 HUD가 **병렬**인지 — 음성이 Hermes 응답을 기다리지 않음을 타임스탬프/로그로 증명.
- 로컬·클라우드 모두 **수치 환각 없음**(deterministic 경로 경유).
- **키 미노출** — 브라우저 네트워크 탭 점검.
- **폴백** — 로컬 모델 다운/혼잡 시 클라우드-only 텍스트로 degrade(데모 안전망).
- 음성·텍스트 입력 둘 다 동작, 잘못된 입력/네트워크 에러에 앱 안 죽음.

## 비범위

- 제약 JSX **생성·샌드박스·자기치유** 자체 = **M3**. 여기선 HUD delta를 흘려보낼 *통로*만 만들고 실제 생성은 M3와 합류.
- 화자 분리, 다국어 자동 전환 고급 튜닝, barge-in 정교화.

---

### Claude Code에 붙여넣을 프롬프트 (패턴 A)

```
[맥락] AGENTS.md와 docs/기획서.md, 그리고 이 브리프(docs/briefs/M5-hybrid-voice-routing.md)를 먼저 읽어.
       우리는 generative HUD 자비스를 만든다. 이번엔 그 "하이브리드 음성 라우팅"의 토대를 만든다.
       로컬 음성 경로는 아직 미구현이다(M0 voice_smoke_test.py 제거됨) — S0에서 스파이크부터 새로 작성해 돌려라.
[목표] 먼저 S0 스파이크: 새 스파이크를 작성해 "로컬 즉답 TTS"와 "Hermes /v1 호출"을 asyncio로
       동시에 띄우고, 음성 TTFA와 HUD 첫 토큰 시각을 각각 찍어 '음성이 클라우드와 무관하게 먼저 난다'를 숫자로 증명해.
[제약] 음성을 클라우드 임계경로에 두지 마라. 수치는 LLM이 지어내지 말고 도구/코드가. 키는 서버측에만.
       새 라이브러리(FastAPI/websockets 등)는 쓰기 전에 한 줄로 제안하고 진행.
[출력] feature/voice-orchestrator 브랜치, 작은 커밋. 스파이크 결과(TTFA·HUD 첫토큰·병렬 증명 로그) 보고.
[검증] 브리프의 "검증" 체크리스트를 네가 먼저 통과시키고 결과를 보고해.
```
```
