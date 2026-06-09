# M0 런북 — De-risk 스파이크 (6/1, ~8h)

> ⚠️ **일부 폐기/완료된 역사 문서.** M0 자체는 통과(Hermes 백엔드·연결 검증). 단 **Spike B 음성 스모크 테스트의 '로컬 Qwen' 부분은 폐기** — 두뇌 구조가 단일 Hermes 브레인 + 역할 하이브리드로 바뀌었고(`docs/decisions/0001`), 음성 검증은 S0 스파이크(`hermes_spike.py`)로 대체됨. `voice_smoke_test.py`도 제거됨. STT(faster-whisper)·TTS(ElevenLabs)는 유지.

목표는 **가장 큰 미지수 셋을 커밋 전에 죽이는 것**이다. 코드 품질·구조는 신경 쓰지 않는다. 전부 버릴 throwaway. 끝에 Go/No-Go만 판단한다.

검증할 셋:
1. **Hermes 백엔드 경로** — 설치되고, 모델 붙고, 대화가 도는가
2. **음성 왕복 지연** — faster-whisper→LLM→ElevenLabs가 실제로 돌고, 0.5초 목표까지 거리가 얼마인가
3. **JSX 샌드박스 렌더** — 문자열 JSX를 React가 안전하게 렌더하는가

---

## Spike A — Hermes를 Docker로 배포 (~2h)

> **왜 Docker인가:** 격리가 아니라 **배포 가능성** 때문. Hermes에는 공식 이미지와 `docker-compose.yml`이 있어 컨테이너 하나로 어디든(데모 머신·$5 VPS) 재현 가능하게 올릴 수 있다.

**용어 함정 — Hermes에서 "Docker"는 두 가지를 뜻한다:**
1. **Hermes를 컨테이너로 배포** ← 우리가 원하는 것
2. **에이전트의 터미널 backend로서 Docker** — 에이전트가 명령/툴을 격리 컨테이너에서 실행하는 것 (local/SSH/Daytona/Modal 등과 나란한 옵션)

둘은 별개다. 우리는 (1). (개발 중엔 WSL2 네이티브 설치 `install.sh | bash` 로 빠르게 굴리고, 배포용으로 (1)을 쓰는 하이브리드도 가능.)

`deploy/docker-compose.yml` · `deploy/Caddyfile` · `deploy/.env.example` · `deploy/bringup.sh` 동봉. 공식 **공개 이미지** `nousresearch/hermes-agent:latest` 사용(우리 폴더엔 Dockerfile 없으니 build 아님).

```bash
# WSL2 안에서
# 0) 최초 1회: 설정 마법사 (프로바이더/모델/툴 → ~/.hermes 에 저장)
mkdir -p ~/.hermes
docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent setup

# 1) .env 준비 (API_SERVER_KEY = openssl rand -hex 32)
cd deploy && cp .env.example .env && $EDITOR .env

# 2) 첫 항목: hermes만 띄워 백엔드 경로 검증 (caddy는 DDNS 준비 후 2단계에서)
bash bringup.sh
#  → docker compose up -d hermes → hermes doctor → /v1/models 응답까지 한 번에 확인
```

> 대시보드(선택)는 별도 컨테이너로 못 띄운다(게이트웨이와 PID 공유 필요) → hermes 서비스에 `HERMES_DASHBOARD=1` 로 같은 컨테이너 side-process. 데모엔 불필요.

핵심 사실:
- 데이터(메모리·로그·설정·세션)는 `~/.hermes` → 컨테이너 `/opt/data` 볼륨에 영속.
- **Hermes 컨테이너는 클라우드 모델을 쓰므로 GPU 불필요** → 가볍다. 음성 파이프라인(faster-whisper+Qwen)만 GPU를 쓴다.

### 배포 타깃 = 집 워크스테이션(서버) + 데모장 노트북(클라이언트) (확정)
무거운 건 전부 **집 RTX 4080 워크스테이션**에 두고, 데모장에선 **노트북으로 원격 접속**한다.

| 위치 | 구동 |
|---|---|
| 집 워크스테이션 | Hermes(WSL2 Docker, API 서버 `127.0.0.1:8642`) · 음성 파이프라인(호스트 GPU) · **React 정적 빌드 서빙 + 리버스 프록시(Caddy, TLS)** |
| 데모장 노트북 | **브라우저로 `https://<DDNS>/` 하나만 접속.** 마이크 입력은 브라우저(WebAudio). 노트북엔 설치/빌드 아무것도 안 함 |

### 연결 = 포트포워딩 + DDNS + TLS (확정)
이미 RDP를 같은 공유기 포트포워딩+DDNS로 잘 쓰고 있으니 인프라가 검증돼 있다. 포트 하나만 더 열면 된다. **릴레이가 없어 지연이 가장 낮다 → 음성에 유리.**

**단, 여는 게 RDP보다 민감하다.** Hermes API 서버는 LLM 키를 들고 도구를 실행한다. 평문 포트로 그냥 열면 안 되고, 아래 가드레일을 반드시 건다:

- **TLS 필수.** API 서버(`127.0.0.1:8642`)는 localhost에 묶어 두고, 그 앞에 **Caddy 리버스 프록시**(자동 HTTPS, Let's Encrypt)를 세워 DDNS 도메인으로 종단. 공유기는 **80·443만** Caddy로 포워딩. → `deploy/Caddyfile`, `deploy/docker-compose.yml`(caddy 서비스) 동봉.
- `API_SERVER_KEY` = 강한 랜덤(`openssl rand -hex 32`), 항상 켠다. `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1` 유지(인터넷 직노출 0.0.0.0 금지 — Caddy만 외부를 향함).
- **키를 프론트에 넣지 않는다.** 노트북 브라우저가 공개 URL로 SPA를 받으므로 JS에 `API_SERVER_KEY`를 박으면 누구나 추출 가능. 대신 **Caddy가 서버측에서** `/v1/*` 프록시 요청에 `Authorization: Bearer` 헤더를 주입하고, 사이트 전체를 **basic-auth**로 게이트한다. 프론트는 같은 출처 `/v1/...`를 키 없이 호출하고, 데모장에선 basic-auth 비밀번호만 입력하면 끝.
- **공개 포트는 443** 사용 → TLS + 행사장 egress가 443은 거의 허용하므로 노트북에서 잘 나간다.
- 데모 끝나면 포트포워딩 **끄기**(상시 노출 줄이기). 가능하면 비표준 경로/속도 제한도.

**⚠️ WSL2 인바운드 함정 (RDP와 다른 점):** RDP는 Windows 네이티브 서비스라 바로 닿지만, Hermes/Caddy는 **WSL2 안**에 있다. 라우터→Windows→WSL2로 인바운드가 들어오게 해야 한다:
- Win11이면 `.wslconfig` 에 `networkingMode=mirrored` (가장 깔끔, WSL2 포트가 호스트에 그대로 노출), **또는**
- `netsh interface portproxy add v4tov4 listenport=443 connectaddress=<WSL2 IP> connectport=443` (WSL IP가 재부팅마다 바뀌니 스크립트화).

**검증 기준:** `docker compose up` → `hermes doctor` 그린 → `curl https://<DDNS>/v1/chat/completions -H "Authorization: Bearer $API_SERVER_KEY" ...` 로 **다른 네트워크의 노트북에서** 스트리밍 응답 1회 성공.

### React ↔ Hermes 연결 메모
핸드오프 문서의 "게이트웨이 웹소켓"은 부정확(게이트웨이는 Telegram/Discord 등 채팅용). 정답은 **gateway 내장 OpenAI 호환 API 서버**: `/v1/chat/completions`(+ 상태형 `/v1/responses`), 표준 SSE 스트리밍 → React에서 OpenAI SDK/fetch로 바로. 프론트는 **같은 출처** `https://<DDNS>/v1/...` 를 호출(키는 Caddy가 주입). 같은 도메인이라 CORS·키 노출 둘 다 없음.

**⚠️ 데모 리스크 — M0에서 미리 확인:**
1. **지연.** 마이크가 노트북에 있어 오디오가 집까지 왕복한다. 0.5s 예산에 WAN 홉이 더해진다. 음성 스모크 테스트(Spike B)를 localhost뿐 아니라 **다른 네트워크의 노트북에서도** 재서 실제 숫자를 본다.
2. **행사장 네트워크.** 막히거나 느릴 수 있다. 핫스팟을 백업 회선으로, **백업 녹화**를 데모 안전망으로 준비(→ M6). ※ 워크스테이션은 집·노트북은 브라우저뿐이라 로컬 폴백이 없다 → 녹화가 유일한 안전망.

막히면 즉시 **LLM 모킹**으로 HUD 작업(M2~M4)을 선병행 — 백엔드 늪 회피.

---

## Spike B — 음성 스모크 테스트 (~3h)

`voice_smoke_test.py` 를 쓴다. **단계별 지연을 재서 0.5초 목표까지 거리를 본다.**

```bash
pip install faster-whisper sounddevice numpy elevenlabs requests

export ELEVENLABS_API_KEY=...
export ELEVENLABS_VOICE_ID=...      # 자비스 보이스 ID

# (선택) 로컬 LLM
ollama serve &           # 또는 이미 실행 중
ollama pull qwen2.5:7b   # 문서의 Qwen 계열. 태그는 가진 것으로 교체

# 1) STT+TTS 지연만 격리 (LLM 빼고)
python voice_smoke_test.py --seconds 5 --llm none

# 2) 풀 파이프라인
python voice_smoke_test.py --seconds 5 --llm ollama --llm-model qwen2.5:7b
```

**읽는 법:** 스크립트가 STT / LLM / **TTS TTFA(첫 소리까지)** 를 찍고 "체감 왕복"을 합산한다. 자비스 음성은 듣는 속도에 묶이므로 raw 생성속도보다 **TTFA가 체감 지연의 핵심**이다.

**현실 보정 — 레퍼런스의 함정:** 추천 레퍼런스 `AlexandreSajus/JARVIS`는 Deepgram(STT)→GPT→ElevenLabs를 **순차**로 돌려 약 3.8초가 걸린다(transcribe 1.2s + LLM 0.7s + audio 1.9s). 즉 그 구조 그대로면 0.5초는 절대 안 나온다. 0.5초는 M5에서 **STT 부분결과 → LLM 토큰 → TTS 청크를 겹쳐 흘려보내는 streaming overlap**으로 만든다. M0에선 "각 조각이 돌고, 합이 얼마인가"만 확인하면 충분.

**검증 기준:** 마이크로 말하면 자비스 보이스로 응답이 재생되고, 합산 지연 숫자가 손에 잡힘. 이 숫자가 M5 범위를 정한다 (이미 1.5초 안쪽이면 streaming만으로 0.5초 가시권 / 4초대면 모델·라우팅부터 손봐야).

GPU 메모: RTX 4080 Super 16GB에 faster-whisper(`--model small`이나 `medium`) + Qwen 동시 상주. TTS는 클라우드라 GPU 미사용. `--device cuda` 기본.

---

## Spike C — JSX 샌드박스 hello-render (~2h)

평가 핵심(generative HUD)의 가장 뾰족한 프론트 리스크: **임의의 LLM 생성 JSX 문자열을 안전하게 렌더**할 수 있는가.

```bash
npm create vite@latest hud-spike -- --template react-ts
cd hud-spike && npm i react-live
npm run dev
```

`App.tsx`에서 `react-live`의 `<LiveProvider code={...}><LivePreview/></LiveProvider>`로 **하드코딩 JSX 문자열 1개**를 렌더해 본다. 스코프에 컴포넌트 몇 개만 노출. (Sandpack은 더 무겁지만 iframe 격리가 강함 — M3에서 비교)

**검증 기준:** 문자열로 들고 있는 JSX가 화면에 뜬다. 에러 JSX를 넣었을 때 앱이 죽지 않고 에러 경계가 잡힌다(자기치유 루프의 씨앗).

---

## Go / No-Go 체크리스트

- [ ] A: `docker compose up` 후 `hermes doctor` 그린 (Docker 배포 경로 검증)
- [ ] A: OpenAI 호환 API 서버에 키로 스트리밍 요청 1회 성공 (React 연결 경로 확정)
- [ ] A+: Tailscale로 **다른 기기(노트북)에서** 워크스테이션 API 서버에 키로 접근 1회 성공
- [ ] B: 음성 파이프라인 1회 왕복 성공 + 합산 지연 숫자 확보 (localhost **및** 터널 너머 노트북, 둘 다 측정)
- [ ] C: 문자열 JSX 렌더 + 에러 경계 동작

**결정 규칙**
- 넷 다 그린 → 계획대로 M1 진행.
- A만 막힘 → LLM 모킹으로 M2~M4 먼저, A는 병행.
- A+가 막힘(터널/방화벽) → 데모를 **워크스테이션 로컬 화면**으로 돌리는 폴백을 1순위 백업으로 확보(노트북 원격은 베스트 케이스).
- B가 4초대(또는 터널 너머에서 크게 늘면) → M5에 모델 경량화/라우팅 추가, 데모는 텍스트 트리거 폴백 준비.
- C가 막힘 → 평가 핵심이 위태로우니 **여기에 시간을 더 쓴다** (다른 건 미뤄도 됨).
