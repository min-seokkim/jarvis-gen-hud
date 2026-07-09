# jarvis-gen-hud · 생성형 HUD

> 아이언맨의 자비스에서 착안한 프로젝트입니다. 채팅으로 명령하면 그 작업에 맞는 화면(HUD)을 LLM이 생성해서 보여주는 웹앱입니다.

## 소개

채팅으로 명령을 보내면 LLM이 답변과 함께 그 작업에 맞는 UI를 JSX로 생성하고, 앱이 이를 검증해 샌드박스에 렌더합니다. 이 **생성형 HUD(Generative HUD)** 를 구현한 React 프론트엔드가 저장소의 본체입니다.

두뇌는 직접 만들지 않고 Hermes Agent를 OpenAI 호환 API로 붙여 씁니다. HUD에 들어가는 라이브 데이터는 같이 들어 있는 Python 오케스트레이터가 공급합니다.

## 핵심 기능

- HUD는 미리 만들어 둔 화면이 아니라 LLM이 매번 생성하는 JSX입니다. 처음 요청받는 종류의 작업도 같은 방식으로 화면이 만들어집니다.
- 생성된 JSX는 디자인 토큰과 허용된 컴포넌트 범위 안에서만 쓰도록 프롬프트와 정적 검증기로 제한합니다.
- 렌더는 격리된 iframe 안에서 react-live로 합니다. 검증이나 렌더가 실패하면 오류 내용을 담아 재생성을 요청하고(최대 2회), 그래도 실패하면 대체 패널을 띄웁니다.
- 명령을 보내면 빠른 모델의 짧은 첫 반응이 먼저 스트리밍되고, 본 답변이 도착하는 동안 HUD가 함께 렌더됩니다.
- 디스크·빌드 상태처럼 변하는 값은 WebSocket 구독으로 데이터만 갱신하고 JSX는 다시 생성하지 않습니다.

## 어떻게 돌아가나

프론트엔드는 같은 출처의 `/v1/responses`(OpenAI Responses API)로 두뇌에 SSE 스트리밍으로 말을 겁니다.

여기서 헷갈리기 쉬운 게 "OpenAI 호환"이라는 표현인데, 규격이 OpenAI와 같다는 뜻이지 OpenAI사를 호출한다는 뜻이 아닙니다. 실제로는 Hermes가 로컬에 띄운 API 서버라서, OpenAI용 클라이언트를 그대로 붙일 수 있다는 정도의 의미입니다.

API 키는 프론트엔드에 절대 넣지 않습니다. Caddy가 서버 쪽에서 `Authorization` 헤더를 끼워 넣고, 사이트 자체도 basic-auth로 잠가 둡니다. 모델 이름은 env로만 넘기게 해 둬서 두뇌 쪽 모델을 갈아끼워도 프론트는 손댈 게 없습니다.

## 기술 스택

| 영역 | 선택 |
|---|---|
| 프론트엔드 | React (Vite + TypeScript) 반응형 웹앱 |
| HUD 렌더링 | 제약 JSX 샌드박스 (react-live + iframe 격리, 자기치유) |
| 두뇌 | 단일 Hermes Agent (OpenAI 호환 API 서버로 연결) |
| 두뇌 모델 | 역할 하이브리드. 첫 반응은 빠른 모델이, 본 답변은 큰 모델이 맡음 (각각 env로 지정) |
| 라이브 소스 | Python 오케스트레이터 (FastAPI, `/sources` 목록 + `/ws` 실시간 푸시) |
| 배포 | Docker(Hermes) + Caddy(TLS·프록시) + 포트포워딩·DDNS |

이렇게 고른 이유는 [기획서](docs/기획서.md)에 적어 뒀습니다.

## 실행 방법

`deploy/.env`에 키와 도메인을 채운 뒤 `make up`으로 띄웁니다.

```bash
cp deploy/.env.example deploy/.env   # API 키, DDNS 도메인, basic-auth 값 채우기
make up
```

`make up`은 프론트 빌드부터 헬스체크까지 순서대로 실행하고, 다음 네 가지가 올라옵니다.

- 공개 종단을 맡는 **Caddy** (자동 HTTPS, basic-auth, 키 주입)
- 두뇌인 **Hermes** (Docker)
- 라이브 HUD 소스를 맡는 **오케스트레이터** (호스트에서 직접 실행, `127.0.0.1:8765`만 바인드)
- `web/dist`로 빌드돼서 Caddy가 서빙하는 **프론트엔드**

### 미리 준비할 것

- Docker(compose 플러그인 포함), Node, Python 3
- `deploy/.env` 채우기 — `API_SERVER_KEY`(`openssl rand -hex 32` 같은 걸로), `DDNS_DOMAIN`, `BASIC_AUTH_*`
- Hermes 설정은 처음 한 번만 마법사를 돌리면 됩니다.
  ```bash
  docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent setup
  ```

### 주요 명령

| 명령 | 하는 일 |
|---|---|
| `make up` | 프론트 빌드 → 오케스트레이터 설치·기동 → `docker compose up` → 헬스체크 |
| `make down` | 컨테이너 종료 + 오케스트레이터 중지 (유닛은 남아서 재부팅하면 다시 뜸) |
| `make logs` / `make logs-orch` | Hermes·Caddy / 오케스트레이터 로그 보기 |
| `make health` | `/v1/models` · `/sources` · Caddy 응답 점검 |
| `make orchestrator-uninstall` | 오케스트레이터 유닛 완전히 제거 |

### 알아두면 좋은 것

오케스트레이터만 호스트에서 직접 돕니다. 호스트 도구와 동적 소스에 닿아야 해서 그런 거고, Caddy는 host networking으로 호스트 loopback(`127.0.0.1:8765`)에 직접 연결합니다. 오케스트레이터와 Hermes는 loopback에만 바인드돼 LAN·외부로 노출되지 않습니다(공개되는 건 Caddy의 80/443뿐). 참고로 `~/.hermes` 하나에 gateway를 두 개 띄우면 충돌하니, 배포는 Docker Hermes 하나로만 돌립니다.

GPU가 없어도 돌아갑니다. 레포 기본 소스(`disk`, `project`, `build_sim`, `proc_watch`)만으로 동작하고, GPU 같은 동적 소스는 호스트마다 다른 설정이라 `orchestrator/sources/dynamic/*.json.example`을 복사해서 켜는 방식입니다(커밋은 하지 않습니다). `nvidia-smi`가 없으면 그 소스만 `caution`으로 뜨고 나머지는 멀쩡합니다.

## 프로젝트 구조

```
.
├── README.md
├── jarvis_handoff.md          # 설계 배경·논리 (원본 핸드오프)
├── Makefile                   # 한 방 배포 (make up)
├── docs/                      # Wiki 동기화용 문서
│   ├── 기획서.md
│   ├── agent-workflow.md
│   ├── briefs/ · decisions/   # 마일스톤 브리프 · ADR
│   └── 회고록-1·2·3주차.md
├── deploy/                    # 배포 (compose, Caddy, systemd 유닛, .env)
├── web/                       # React 앱 (Vite + TS)
├── orchestrator/              # 라이브 HUD 소스 오케스트레이터 (Python: /sources·/ws)
├── AGENTS.md                  # 코딩 에이전트 기준 문서 (canonical)
└── CLAUDE.md                  # Claude Code 진입점 (@AGENTS.md 참조)
```

## 개발 규칙

- **브랜치:** `main` → `dev` → `feature/*` (feature는 dev로 PR)
- **Task:** GitHub Issue로 등록·관리 (기능/컴포넌트 단위)
- **기획·문서:** GitHub Wiki (`docs/`와 동기화)
- **PR:** feature 단위로 `feature/* → dev`
- **커밋·이슈 연결:** 커밋 메시지에 `#이슈번호`

## 진행 상태

| 주차 | 목표 | 상태 |
|---|---|---|
| 1주차 | 프로젝트 기획 + Agent workflow 흐름 초안 | 기획·기술스택 확정, Hermes 두뇌 셋업·검증, 배포 구조 설계까지 완료 |
| 2주차 | 앱 셸 + 스트리밍 대화 + 생성형 HUD 코어 | 완료. 텍스트로 명령하면 스트리밍 응답과 맥락 HUD 생성까지 한 바퀴 도는 수직 슬라이스 완성 |
| 3주차 | HUD 발명 + 음성 파이프라인 + 배포·데모 | HUD 발명, 세션 연속성, 라이브 소스, iframe 격리, 배포까지 완료. 음성(STT/TTS)은 범위에서 빼기로 해서 구현하지 않음 (입력은 텍스트뿐) |

## 링크

- 기획서 · Agent Workflow · 회고록 → [`docs/`](docs/) (및 GitHub Wiki)
- 코딩 에이전트 기준 → [`AGENTS.md`](AGENTS.md) (CLAUDE.md가 참조)
- 상세 설계 배경 → [`jarvis_handoff.md`](jarvis_handoff.md)
