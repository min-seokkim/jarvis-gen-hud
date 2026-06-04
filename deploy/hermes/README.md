# Hermes 자비스 페르소나 (SOUL.md)

Hermes를 자비스처럼 말하게 만드는 페르소나 파일. Hermes는 `HERMES_HOME/SOUL.md`(= `~/.hermes/SOUL.md`)를 **시스템 프롬프트 1번 슬롯(에이전트 정체성)** 으로 그대로 주입한다. 프론트는 시스템 프롬프트를 보내지 않으므로, 페르소나의 단일 출처는 이 파일이다.

> SOUL.md는 verbatim으로 프롬프트에 들어간다(보안 스캔·20k자 truncation만 거침). 그래서 이 파일엔 **페르소나만** 담는다 — 설치 절차·경로 같은 운영 메모는 여기(README)에만 둔다.

## 설치 (WSL2 호스트에서)

> ⚠️ **Docker 함정 — 프로필 경로.** 공식 `nousresearch/hermes-agent` 이미지는 **프로필(profile)** 구조다. 신선한 컨테이너엔 `default` 프로필 게이트웨이 하나가 등록돼 돌고, 그 게이트웨이는 **자기 프로필 디렉터리의 SOUL**을 읽는다 — 즉 `~/.hermes/SOUL.md`(최상위)가 아니라 **`~/.hermes/profiles/default/SOUL.md`** 다. 최상위에 둔 SOUL.md는 무시되고 Hermes 기본 정체성("나는 Hermes Agent…")으로 떨어진다.

`~/.hermes`는 compose에서 컨테이너 `/opt/data`로 마운트된다. 호스트 파일만 바꾸면 된다.

```bash
REPO=/mnt/e/OneDrive/Documents/SNU_2026_Spring/FE/term_project   # 실제 경로로 조정

# 0) 활성 프로필 이름 확인 (보통 default)
docker compose exec hermes hermes profile list

# 1) 활성 프로필 자리에 SOUL.md 배치 (최상위가 아니라 profiles/<이름>/)
mkdir -p ~/.hermes/profiles/default
cp "$REPO/deploy/hermes/SOUL.md" ~/.hermes/profiles/default/SOUL.md

# 2) 그 프로필 게이트웨이 재시작 (SOUL은 세션 시작 시 로드됨)
docker compose exec hermes hermes -p default gateway restart
#   안 되면 컨테이너 전체:  cd deploy && docker compose restart hermes

# 3) 프론트에서 '새 대화'로 시작 — 기존 세션엔 옛 시스템 프롬프트가 캐시돼 있다.
```

`profile list`가 `default`가 아닌 다른 이름을 보이면, 그 이름으로 `~/.hermes/profiles/<이름>/SOUL.md`에 두고 `-p <이름>`으로 재시작한다.

SOUL.md가 발견되면 **그 내용이 기본 정체성(DEFAULT_AGENT_IDENTITY)을 통째로 대체**한다 — 베이스 프롬프트를 따로 끄는 작업은 필요 없다. Hermes는 SOUL.md가 없을 때만 기본 파일을 자동 생성하며, **기존 SOUL.md는 절대 덮어쓰지 않는다.**

### 안 먹을 때 진단

```bash
# 게이트웨이가 실제로 어느 SOUL을 들고 있나 — 두 경로 다 확인
docker compose exec hermes sh -lc 'ls -la /opt/data/SOUL.md /opt/data/profiles/*/SOUL.md 2>/dev/null'
# 부팅 reconciler가 어느 프로필을 살렸나
docker compose exec hermes sh -lc 'tail -n 20 /opt/data/logs/container-boot.log 2>/dev/null'
```

## 검증

컨테이너 안에서 OpenAI 호환 API를 직접 두드려 톤을 확인한다.

```bash
# 정체성 — "나는 Hermes Agent…"가 나오면 SOUL이 안 먹은 것
docker compose exec hermes curl -s http://localhost:8642/v1/chat/completions \
  -H "Authorization: Bearer $API_SERVER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"hermes","messages":[{"role":"user","content":"너는 누구니?"}]}'
```

체크 포인트:

- 한국어로, **짧고 침착하게** 답하는가 (장황하지 않은가).
- 호칭('님'/'sir')을 매 문장 붙이지 않는가.
- 모르는 수치를 **지어내지 않는가** (빌드 데이터가 없으면 모른다/확인 필요라고 하는가).
- "AI 언어모델로서…" 같은 캐릭터 이탈이 없는가.

프론트(M1 대화 패널)에서 같은 질문을 던져 스트리밍 톤도 함께 확인하면 된다.

## 튠 포인트

- **톤을 더/덜 위트 있게:** SOUL.md의 `## 목소리` 항목만 수정 후 재시작.
- **데모용 임시 모드:** 톤을 잠깐 바꾸고 싶으면 `~/.hermes/config.yaml`의 `agent.personalities`에 named 프리셋을 정의하고 `/personality <이름>`으로 세션 오버레이. SOUL.md(기본 정체성)는 그대로 둔다.
- **출처:** [Personality & SOUL.md](https://hermes-agent.nousresearch.com/docs/user-guide/features/personality) · [Prompt Assembly](https://hermes-agent.nousresearch.com/docs/developer-guide/prompt-assembly)
