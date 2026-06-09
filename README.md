# jarvis-gen-hud · 현실 자비스 만들기: 음성 비서와 생성형 HUD

> 아이언맨의 자비스를 진짜로 현실에 만들어보는 프로젝트. 음성으로 대화하고, **작업 맥락에 맞는 UI(HUD)를 그 자리에서 생성**해내는 엔지니어용 자비스.

## 프로젝트 소개
영화 아이언맨의 자비스를 모델로, 엔지니어와 함께 일하는 도우미를 만든다. 핵심이자 직접 0부터 짓는 유일한 부분은 **Generative HUD** — 작업이 바뀌면 인터페이스가 따라 생성되는 React 프론트엔드다. 두뇌·음성·도구 합성은 완성형(Hermes Agent 등)에 위임하고, 역량은 프론트엔드에 집중한다.

## 핵심 기능
- **HUD/UI JSX 실시간 생성** — 맥락 → LLM이 디자인 시스템 토큰/컴포넌트만으로 JSX 생성
- **샌드박스 렌더 + 자기치유** — react-live/Sandpack에서 iframe 격리 렌더, 에러 시 재생성
- **본 적 없는 작업의 HUD 발명** — 미리 만들지 않은 작업도 그 자리에서 인터페이스 생성
- **음성 + HUD 동시성** — 음성으로 답하는 동안 화면에 HUD 생성

## 기술 스택
| 영역 | 선택 |
|---|---|
| 프론트엔드 | React (Vite + TS) 반응형 웹앱 |
| HUD 렌더링 | 제약 JSX 샌드박스 (react-live / Sandpack, iframe 격리, 자기치유) |
| 두뇌/에이전트 | 단일 Hermes Agent (OpenAI 호환 API 서버로 연결) |
| 두뇌 모델 | 역할 하이브리드 — 빠른 메인(Haiku4.5/GPT-5.4-mini) + 강한 delegation(Opus4.6/GPT-5.5), OpenAI·Anthropic만 |
| STT / TTS | faster-whisper (로컬) / ElevenLabs — 오케스트레이터가 /v1 멀티플렉싱 (로컬 LLM 없음) |
| 배포 | Docker(Hermes) + Caddy(TLS·프록시) + 포트포워딩·DDNS |

선택 이유는 [Wiki 기획서](docs/기획서.md) 참조.

## 프로젝트 구조
```
.
├── README.md
├── jarvis_handoff.md          # 설계 배경·논리 (원본 핸드오프)
├── docs/                      # Wiki 동기화용 문서
│   ├── 기획서.md
│   ├── agent-workflow.md
│   ├── tasks.md               # 도출 Task + GitHub 셋업 명령
│   └── 회고록-1주차.md
├── deploy/                    # 배포 (compose, Caddy, env)
├── AGENTS.md                  # 코딩 에이전트 기준 문서 (canonical)
├── CLAUDE.md                  # Claude Code 진입점 (@AGENTS.md 참조)
└── (앱 소스: web/ — 2주차부터)
```

## 개발 관리 규칙
- **브랜치:** `main` → `dev` → `feature/*` (feature는 dev로 PR)
- **Task:** GitHub **Issue**로 등록·관리 (기능/컴포넌트 단위)
- **기획/문서:** GitHub **Wiki** (`docs/`와 동기화)
- **PR:** feature 단위로 `feature/* → dev` PR, 주 1회 동료 PR 코드리뷰
- **커밋/이슈** 연결: 커밋 메시지에 `#이슈번호`

## 진행 상태
- **1주차 (기획·프로토타이핑):** 기획·기술스택 확정, Hermes 에이전트 두뇌 셋업·검증 완료(낯선 기능 실험), 배포 구조 설계. 라이브 로드맵 아티팩트로 M0–M6 계획.
- **2주차~:** generative HUD 코어 루프 → HUD 발명 → 음성 파이프라인.

## 주차별 목표
| 주차 | 목표 |
|---|---|
| 1주차 | 프로젝트 기획 완성 + Agent workflow 흐름 초안 |
| 2주차 | (예정) 앱 셸 + 스트리밍 대화 + generative HUD 코어 |
| 3주차 | (예정) HUD 발명 + 음성 파이프라인 + 배포·데모 |

## 링크
- 기획서 · Agent Workflow · 회고록 → `docs/` (및 GitHub Wiki)
- 코딩 에이전트 기준 → `AGENTS.md` (CLAUDE.md가 참조)
- 상세 설계 배경 → `jarvis_handoff.md`
