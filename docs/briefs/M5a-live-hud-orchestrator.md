# M5a 빌드 브리프 — 라이브 HUD 채널 (오케스트레이터 1차 슬라이스, WS 푸시)

> Cowork 작성 · Claude Code 핸드오프. **"살아 움직이는 HUD"** — 렌더된 HUD의 data를 워크스테이션 오케스트레이터가 WS로 계속 푸시해 갱신한다. JSX는 한 번 발명, 데이터는 흐른다.
> M5(음성)의 1차 슬라이스: 원래 설계(단일 front door 오케스트레이터, `hud.delta` 통로)에서 **음성 빼고 라이브 데이터 채널만** 먼저 짓는다. M5 음성은 이 서비스에 STT/TTS를 얹는 후속.
> 선행: M4 envelope + M4b `/v1/responses` 전환(진행 중 — **이 transport는 건드리지 않는다**, 추가 채널만). 브랜치: `feature/live-hud` → `dev` PR.
> 근거: `orchestrator/` 스텁 존재 · ADR 0002 R1(background notify 버그 #6718 → 폴링 우회) · [[hybrid-routing]] 127.0.0.1 교훈.

## 목표 (Exit)

HUD가 렌더된 뒤에도 **deterministic 소스의 새 값이 주기적으로 흘러들어 같은 JSX가 재렌더**된다 (LLM 재호출 0). 데모 기준: ① 디스크 사용량 HUD의 Gauge가 파일 쓰는 동안 실시간으로 차오른다, ② 백그라운드로 돌린 (가짜)빌드의 Steps/ProgressBar가 단계별로 진행한다. 오케스트레이터가 죽어도 HUD는 마지막 값으로 정적 유지 + `caution` 표시 (앱 안 죽음).

## 아키텍처 (M4b transport에 추가되는 채널)

```
[브라우저]
   ├── /v1/responses (Vite/Caddy 프록시) ──▶ Hermes        ← 대화 + HUD 생성 (M4b, 불변)
   └── WS /ws ──▶ [오케스트레이터 — 워크스테이션 Python (FastAPI+websockets, asyncio)]
                     ├─ 소스 레지스트리 (deterministic Python):
                     │    disk(쓰기영역 사용량) · project(git status) · build_sim(가짜 빌드 진행)
                     │    · proc_watch(백그라운드 프로세스 poll — #6718 우회 패턴)
                     ├─ 구독 관리: hud.subscribe → 주기 수집 → hud.data push → hud.end
                     └─ (보유만) Hermes /v1 server-side 호출 능력 — 반드시 127.0.0.1, 키는 여기(서버측)에만
```

- **단일 front door는 아직 아님** — M4b가 방금 깐 `/v1/responses` 직결을 유지하고, 오케스트레이터는 라이브 데이터 전용 **추가 채널**. (front door 통합은 M5 음성 때 결정.)
- envelope에 **`live` 필드 추가**: `{"live": {"source": "disk", "params": {…}, "intervalMs": 2000} | null}` — 모델이 "이 데이터는 갱신 가능한 소스"라고 **선언**하면 프론트가 구독. `design`과 같은 사상(스키마로 사고 강제). 모델이 모르는 소스를 선언하면 오케스트레이터가 `hud.end(reason:"unknown_source")` → HUD는 정적 유지(무해).

## WS 프로토콜 (최소)

client → server
- `{type:"hud.subscribe", subId, source, params?, intervalMs?}` (intervalMs 하한 1000 강제)
- `{type:"hud.unsubscribe", subId}`

server → client
- `{type:"hud.data", subId, data}` — **전체 교체**(패치 아님 — data가 작으므로 단순하게; D3)
- `{type:"hud.end", subId, reason}` · `{type:"error", message}`

규칙: 새 HUD 렌더 시 이전 구독 unsubscribe. WS 끊기면 지수 백오프 재접속 + 활성 구독 재전송. 프론트는 `hud.data` 수신 시 `hud.data`(state)만 교체 — JSX·design 불변.

## 범위

1. **오케스트레이터 서비스** (`orchestrator/` — FastAPI+uvicorn+websockets, 기존 스텁 대체):
   - `server.py`(WS 엔드포인트 `/ws`, 구독 루프) · `sources/`(레지스트리: `disk.py`, `project.py`, `build_sim.py`, `proc_watch.py`).
   - 소스 인터페이스: `async fetch(params) -> dict` — **전부 deterministic**(셸/psutil/git), LLM 없음.
   - `build_sim`: 단계가 수 초 간격으로 진행하는 가짜 빌드(데모·테스트용 결정적 시나리오, 실패 단계 포함 옵션).
   - `proc_watch`: PID/명령 받아 poll — Hermes `terminal(background=True)` 잡 감시 패턴(R1 우회)의 골격.
   - 실행: `uvicorn orchestrator.server:app --host 127.0.0.1 --port 8765`. 의존성 `orchestrator/requirements.txt`.
2. **프론트 WS 클라이언트** (`web/src/lib/liveHud.ts`): 접속·재접속·구독 관리, `hud.data` → App의 hud state 교체. 연결 상태를 StatusBar에(끊김 = `caution`).
3. **envelope `live` 필드** — 시스템 프롬프트에 사용 가능 소스 목록(레지스트리와 일치) + "갱신 가능한 데이터면 live를 선언하라" 지시. 검증: `live.source`가 허용 목록 밖이면 null 처리(생성 거부까지는 안 함).
4. **프록시 배선** — dev: Vite `server.proxy`에 `/ws`(ws:true, target 127.0.0.1:8765). 배포: Caddyfile `/ws` reverse_proxy(WS 자동 업그레이드) — basic-auth 게이트 뒤.
5. **수명 관리** — HUD 교체/언마운트 시 unsubscribe, 탭 비활성 시 구독 유지(단순하게), 오케스트레이터 다운 시 마지막 data로 정적 + 재접속 시 재구독.

## 결정 필요 (장단점 1줄씩 제시 후 택1)

- **D1 — live 선언 주체:** envelope의 `live` 필드(모델 선언, 일관 사상 — **권장**) vs 프론트 휴리스틱(소스명 매칭). 
- **D2 — Hermes 백그라운드 잡 연동 깊이:** M5a는 `proc_watch` 골격까지만(수동 PID) vs envelope에 잡 메타데이터까지 — **골격까지만 권장**(완전 자동 연동은 M5).
- **D3 — 전체 교체 vs JSON 패치:** 전체 교체 권장(데이터 소형·재렌더 저렴·단순).

## 비범위

- STT·TTS·음성 동시성, 채팅의 front door 이전 → M5
- Hermes가 오케스트레이터 소스를 자동 발견/합성 → 후속 (지금은 소스 목록을 프롬프트에 하드코딩)
- 구독 다중 HUD 동시 갱신, 모바일 백그라운드 최적화 → 후속

## 검증 (완료 선언 전)

- 디스크 HUD: 큰 파일 쓰는 동안 Gauge가 2초 간격으로 차오름 (LLM 호출 0회 — 네트워크 탭 확인).
- build_sim HUD: Steps가 pending→active→done으로 진행, 실패 옵션 시 빨강 + state 전환.
- 새 HUD 생성 → 이전 구독 해지 확인(서버 로그). 오케스트레이터 kill → HUD 정적 유지 + caution, 재시작 → 자동 재구독.
- `live` 미선언 envelope(기존 HUD) 100% 기존 동작 — 회귀 0. M3/M4 e2e 통과.
- 오케스트레이터: 소스 단위 테스트(pytest — deterministic이므로 쉬움). 프론트 `npm run build`/`typecheck`/`lint` 0.
- 키·비밀이 브라우저로 안 감(WS 페이로드에 토큰 없음, Hermes 키는 오케스트레이터 env에만).

---

### Claude Code에 붙여넣을 프롬프트

```
[맥락] AGENTS.md, docs/briefs/M5a-live-hud-orchestrator.md, M4-hud-invention.md, M4b-session-continuity.md를 먼저 읽어.
       M4/M4b의 envelope·/v1/responses transport는 불변. 이번 작업 = 오케스트레이터(Python) 라이브 데이터 WS 채널 +
       프론트 구독 클라이언트 + envelope live 필드. JSX는 재생성하지 않고 data만 갈아끼워 재렌더한다(HudCanvas scope가 이미 hud.data 의존).
[목표] (1) orchestrator/: FastAPI+websockets 서비스, 소스 레지스트리(disk·project·build_sim·proc_watch), 구독 루프
       (2) web/src/lib/liveHud.ts: WS 클라이언트(재접속·재구독), hud.data → App hud state 교체
       (3) envelope에 live 필드(시스템 프롬프트 + 검증: 허용 소스 밖이면 null)
       (4) Vite /ws 프록시 + Caddyfile /ws 블록 (5) pytest 소스 테스트 + 라이브 갱신 e2e(mock WS) 1본
[제약] 오케스트레이터→Hermes는 반드시 127.0.0.1. 키는 오케스트레이터 env에만. 프론트 외부 라이브러리 추가 금지(WS는 네이티브 WebSocket).
       Python 의존성은 requirements.txt에 고정. 모든 소스는 deterministic(LLM 호출 금지).
[결정] D1·D2·D3 — 장단점 1줄씩 제시 후 택1(권장안 브리프에 있음).
[출력] feature/live-hud 브랜치 작은 커밋들. 디스크 Gauge 라이브 갱신 + build_sim 진행 영상/로그 + 검증 체크리스트 통과 보고.
```
