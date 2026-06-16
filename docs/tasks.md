# Task 도출 + GitHub 셋업 가이드

> 1주차 요구: 개발 기능을 위한 Task를 **몇 개 도출**하고 GitHub Issue로 관리.
> 아래 Task는 로드맵(M0–M6)에서 기능/컴포넌트 단위로 뽑은 것. `gh` CLI 명령까지 첨부.

---

## A. 도출한 Task (기능/컴포넌트 단위)

| # | 제목 | 단위 | 마일스톤 | 라벨 |
|---|------|------|---------|------|
| 1 | 음성 스모크 테스트로 STT→LLM→TTS 지연 측정 | 기능 | M0 | `spike` |
| 2 | react-live 샌드박스에 하드코딩 JSX 1개 렌더 | 기능 | M0 | `spike` |
| 3 | 원격 접속(포트포워딩+DDNS+Caddy)로 /v1 스트리밍 1회 확인 | 기능 | M0 | `infra` |
| 4 | 반응형 React 앱 셸 + Hermes 토큰 스트리밍 대화 | 기능 | M1 | `feature` |
| 5 | 레이아웃: 대화 패널 + HUD 캔버스 분리 | 컴포넌트 | M1 | `feature` |
| 6 | 자비스 디자인 토큰 정의(청록/검정/파랑↔빨강) | 컴포넌트 | M2 | `design` |
| 7 | HUD 프리미티브: ProgressBar/Gauge/StatusPanel/Chart/Alert | 컴포넌트 | M2 | `feature` |
| 8 | 제약 JSX 생성→샌드박스 렌더→자기치유 루프 | 기능 | M3 | `core` |
| 9 | 보편 후크: "빌드 상태 보여줘" → 빌드 진행 HUD | 기능 | M3 | `core` |
| 10 | 본 적 없는 작업의 HUD 발명(프롬프트 일반화) | 기능 | M4 | `core` |
| 11 | 음성 파이프라인 통합(faster-whisper→Hermes /v1→ElevenLabs, 오케스트레이터) | 기능 | M5 | `feature` |
| 12 | 데모 2비트 스크립트 + 백업 녹화 | 기능 | M6 | `demo` |

> 1주차엔 이 중 1~4번 정도를 우선 Issue로 등록하고, 나머지는 주차 진행하며 추가.

---

## B. 저장소 + 브랜치 셋업 (`gh` + `git`)

> 사전: `gh auth login` 완료, 프로젝트 닉네임 결정(예: `민석`).

```bash
# 1) 조직 아래 public repo 생성 (네이밍룰 {프로젝트}-{닉네임})
gh repo create boostcampwm-snu-2026/jarvis-hud-민석 --public \
  --description "자비스형 엔지니어 도우미 — generative HUD (부스트캠프 SNU 2026)"

# 2) 현재 term_project 폴더를 이 repo에 연결
cd /mnt/e/OneDrive/Documents/SNU_2026_Spring/FE/term_project
git init -b main
git remote add origin https://github.com/boostcampwm-snu-2026/jarvis-hud-민석.git
git add README.md jarvis_handoff.md docs deploy .claude
git commit -m "chore: 1주차 기획·문서·배포 초안"
git push -u origin main

# 3) 브랜치 전략 main → dev → feature/*
git switch -c dev
git push -u origin dev
# 이후 작업: git switch -c feature/app-shell  (작업 후 feature → dev PR)
```

`.gitignore` 권장(민감정보 커밋 방지):
```bash
printf '%s\n' 'deploy/.env' '*.env' 'node_modules/' 'web/dist/' > .gitignore
git add .gitignore && git commit -m "chore: add .gitignore"
```

---

## C. Wiki 세팅 (기획/문서는 Wiki로)

GitHub Wiki는 별도 `.wiki` git 저장소다. `docs/`의 MD를 그대로 올린다.

```bash
# 웹에서 repo → Wiki 탭 → "Create the first page" 한 번 누른 뒤:
git clone https://github.com/boostcampwm-snu-2026/jarvis-hud-민석.wiki.git
cd jarvis-hud-민석.wiki
cp ../term_project/docs/기획서.md "프로젝트-기획서.md"
cp ../term_project/docs/agent-workflow.md "Agent-Workflow.md"
cp ../term_project/docs/회고록-1주차.md "회고-1주차.md"
git add . && git commit -m "docs: 1주차 기획서·workflow·회고" && git push
```
(또는 Wiki 웹 에디터에 내용 붙여넣기.)

---

## D. Issue 등록 (`gh issue create`)

```bash
cd /mnt/e/OneDrive/Documents/SNU_2026_Spring/FE/term_project

# 라벨 먼저 (선택)
for L in spike infra feature design core demo; do gh label create "$L" 2>/dev/null; done

gh issue create --title "[M0] 음성 스모크 테스트로 STT→LLM→TTS 지연 측정" \
  --label spike \
  --body "음성 스파이크 스크립트로 faster-whisper→LLM→ElevenLabs 1회 왕복 + 단계별 지연 측정. localhost와 원격 노트북 둘 다. **Exit:** 합산 지연 숫자 확보, 0.5s까지 거리 파악."

gh issue create --title "[M0] react-live 샌드박스에 하드코딩 JSX 1개 렌더" \
  --label spike \
  --body "Vite+React+TS에서 react-live로 문자열 JSX 1개 렌더 + 에러 경계 동작 확인. **Exit:** 문자열 JSX가 화면에 뜨고, 잘못된 JSX에 앱이 안 죽음."

gh issue create --title "[M1] 반응형 앱 셸 + Hermes 토큰 스트리밍 대화" \
  --label feature \
  --body "폰/PC 한 앱. Hermes OpenAI 호환 API(/v1)로 토큰 스트리밍 대화 UI. **Exit:** 입력→스트리밍 응답이 반응형 레이아웃에 표시."

gh issue create --title "[M1] 레이아웃: 대화 패널 + HUD 캔버스 분리" \
  --label feature \
  --body "대화 패널과 generative HUD가 렌더될 캔버스 영역 분리. 모바일은 탭/스택 전환."
```
> 나머지 Task(5~12)도 같은 형식으로 주차 진행하며 추가. 커밋 메시지에 `#이슈번호`로 연결.

---

## E. 1주차 체크리스트 (제출 기준)
- [ ] public repo `boostcampwm-snu-2026/jarvis-hud-{닉네임}` 생성
- [ ] `main`/`dev` 브랜치
- [ ] README에 프로젝트 정보 + 관리 규칙
- [ ] Wiki: 기획서 + Agent workflow 초안 + 회고 1편
- [ ] Issue 몇 개 등록
- [ ] (권장) 그룹 동료 PR 코드리뷰 1회
