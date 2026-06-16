# J.A.R.V.I.S — 한 방 배포 (배포 모델 A: 하이브리드)
#
#   Caddy(공개 종단·TLS·basic-auth) + Hermes(Docker) + 오케스트레이터(호스트 네이티브
#   systemd user 유닛, 8765) + 프론트(빌드→web/dist, Caddy가 /srv로 서빙).
#
#   make up        클린 기동: 프론트 빌드 → 오케스트레이터 설치·기동 → docker compose up → 헬스체크
#   make down      docker compose down + 오케스트레이터 중지(유닛은 enable 유지 → 재부팅 자동기동)
#   make logs      hermes/caddy 로그 follow         make logs-orch  오케스트레이터 로그 follow
#   make health    /v1/models · /sources · caddy 응답 점검 (실패 시 비정상 종료)
#   make orchestrator-uninstall   유닛 중지·비활성·제거
#
# 전제: Docker(+compose plugin)·Node·Python3, deploy/.env(값 채움), ~/.hermes 설정 마법사 1회.
# 레포는 GPU/호스트 비종속 — 빌트인 소스만으로 동작(동적 소스는 호스트 로컬, dynamic/*.json.example 참조).

# 주: .ONESHELL은 쓰지 않는다. (.ONESHELL + 비표준 SHELL 조합에서 make가 내부 라인의
# '@' 프리픽스를 못 떼고 셸에 그대로 넘겨 모든 멀티라인 타깃이 깨짐.)
SHELL       := /bin/bash

REPO        := $(CURDIR)
VENV        := $(REPO)/.venv
VENV_PY     := $(VENV)/bin/python
COMPOSE_FILE:= deploy/docker-compose.yml
ENV_FILE    := deploy/.env
COMPOSE     := docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE)
UNIT        := jarvis-orchestrator.service
UNIT_SRC    := deploy/jarvis-orchestrator.service
UNIT_DST    := $(HOME)/.config/systemd/user/$(UNIT)
# systemctl --user는 헤드리스 SSH에서 XDG_RUNTIME_DIR이 필요할 수 있다.
SYSTEMD_ENV := XDG_RUNTIME_DIR=$${XDG_RUNTIME_DIR:-/run/user/$$(id -u)}

.DEFAULT_GOAL := help
.PHONY: help up down logs logs-orch health preflight build-web venv \
        orchestrator-install orchestrator-uninstall compose-up compose-down

help:
	@echo "J.A.R.V.I.S 배포 (모델 A 하이브리드) — 주요 타깃:"
	@echo "  make up                     클린 기동 (빌드→오케스트레이터→compose→헬스)"
	@echo "  make down                   compose down + 오케스트레이터 중지"
	@echo "  make logs / logs-orch       hermes·caddy / 오케스트레이터 로그 follow"
	@echo "  make health                 /v1/models · /sources · caddy 점검 (실패 시 exit 1)"
	@echo "  make orchestrator-uninstall 유닛 중지·비활성·제거"

# ── 한 방 기동 ───────────────────────────────────────────────────────────────
up: preflight build-web orchestrator-install compose-up health
	@echo
	@echo "✅ up 완료. 공개 접속: https://$$(grep -E '^DDNS_DOMAIN=' $(ENV_FILE) | cut -d= -f2-)  (basic-auth)"

# .env 값은 source 하지 않는다(bcrypt 해시 등 '$' 포함 값이 셸 확장으로 깨짐). grep/cut로 읽는다.
preflight:
	@echo "== 0. 사전 점검 =="
	@command -v docker >/dev/null 2>&1 || { echo "❌ Docker 없음"; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo "❌ 'docker compose' 플러그인 없음"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "❌ Node 없음 (프론트 빌드용)"; exit 1; }
	@{ test -x $(VENV_PY) || command -v python3 >/dev/null 2>&1; } || { echo "❌ python3 없음 (오케스트레이터용)"; exit 1; }
	@test -f $(ENV_FILE) || { echo "❌ $(ENV_FILE) 없음 — 'cp deploy/.env.example deploy/.env' 후 값 채우기"; exit 1; }
	@[ -n "$$(grep -E '^API_SERVER_KEY=' $(ENV_FILE) | cut -d= -f2-)" ] || { echo "❌ API_SERVER_KEY 비어 있음 (openssl rand -hex 32)"; exit 1; }
	@[ -n "$$(grep -E '^DDNS_DOMAIN=' $(ENV_FILE) | cut -d= -f2-)" ]    || { echo "❌ DDNS_DOMAIN 비어 있음 (Caddy 자동 HTTPS용)"; exit 1; }
	@{ test -d "$(HOME)/.hermes" && ls "$(HOME)/.hermes"/config.y*ml >/dev/null 2>&1; } || { \
	  echo "❌ ~/.hermes 설정 없음 — 설정 마법사 1회 실행:"; \
	  echo "    docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent setup"; exit 1; }
	@# 한 ~/.hermes 에 gateway 둘 동시 금지 — 호스트 네이티브 hermes gateway가 떠 있으면 경고.
	@pgrep -fa "hermes .*gateway" >/dev/null 2>&1 && \
	  echo "⚠️  호스트에 hermes gateway 프로세스가 보입니다 — Docker hermes와 ~/.hermes 충돌 위험. 네이티브를 끄세요." || true
	@echo "   OK"

# ── 프론트 빌드 → web/dist (Caddy가 /srv 로 마운트) ──────────────────────────
build-web:
	@echo "== 1. 프론트 빌드 (web/dist) =="
	@cd web && { test -f package-lock.json && npm ci || npm install; } && npm run build
	@test -f web/dist/index.html || { echo "❌ web/dist/index.html 없음 — 빌드 실패"; exit 1; }
	@echo "   OK (web/dist)"

# ── 오케스트레이터: venv + systemd user 유닛 설치·기동 ──────────────────────
venv:
	@test -x $(VENV_PY) || { echo "== venv 생성 =="; python3 -m venv $(VENV); }
	@$(VENV_PY) -m pip install -q --upgrade pip
	@$(VENV_PY) -m pip install -q -r orchestrator/requirements.txt
	@echo "   venv OK ($(VENV_PY))"

orchestrator-install: venv
	@echo "== 2. 오케스트레이터 호스트 네이티브 설치·기동 (8765) =="
	@mkdir -p "$(dir $(UNIT_DST))"
	@sed -e 's|__REPO_DIR__|$(REPO)|g' -e 's|__VENV_PY__|$(VENV_PY)|g' $(UNIT_SRC) > "$(UNIT_DST)"
	@# 로그인 없이도(재부팅 후) 구동되도록 linger 활성 — 실패해도 비치명적.
	@loginctl enable-linger "$$USER" 2>/dev/null || echo "   (linger 설정 생략/실패 — 재부팅 자동기동엔 'sudo loginctl enable-linger $$USER' 필요)"
	@# 헤드리스 SSH: user systemd 매니저/버스가 올라올 때까지 잠깐 대기.
	@for i in 1 2 3 4 5 6 7 8 9 10; do [ -S "/run/user/$$(id -u)/bus" ] && break; sleep 1; done
	@$(SYSTEMD_ENV) systemctl --user daemon-reload || { echo "❌ systemctl --user 사용 불가 — user systemd(linger/로그인 세션) 확인 후 재시도"; exit 1; }
	@$(SYSTEMD_ENV) systemctl --user enable --now $(UNIT)
	@echo "   유닛 enable·start 완료 (응답은 make health 가 검증)"

orchestrator-uninstall:
	@$(SYSTEMD_ENV) systemctl --user disable --now $(UNIT) 2>/dev/null || true
	@rm -f "$(UNIT_DST)"
	@$(SYSTEMD_ENV) systemctl --user daemon-reload 2>/dev/null || true
	@echo "✅ 오케스트레이터 유닛 제거"

# ── Docker (hermes + caddy) ─────────────────────────────────────────────────
# HERMES_UID/GID를 셸에서 주입(──env-file의 빈 값보다 셸 환경이 우선) → ~/.hermes 파일이 호스트 유저 소유.
compose-up:
	@echo "== 3. docker compose up (hermes + caddy) =="
	@HERMES_UID=$$(id -u) HERMES_GID=$$(id -g) $(COMPOSE) up -d
	@echo "   기동 대기..."; sleep 6

compose-down:
	@$(COMPOSE) down

# ── 헬스체크 (하나라도 실패하면 exit 1 → make up이 거짓 성공 배너를 띄우지 않음) ──
health:
	@echo "== 4. 헬스체크 =="
	@key=$$(grep -E '^API_SERVER_KEY=' $(ENV_FILE) | cut -d= -f2-); fail=0; \
	  printf "   hermes 컨테이너 running : "; \
	  if docker inspect -f '{{.State.Running}}' hermes 2>/dev/null | grep -q true; then echo OK; else echo "❌"; fail=1; fi; \
	  printf "   hermes /v1/models      : "; \
	  if $(COMPOSE) exec -T hermes sh -c 'command -v curl' >/dev/null 2>&1; then \
	    $(COMPOSE) exec -T hermes curl -fs -m 10 -H "Authorization: Bearer $$key" http://localhost:8642/v1/models >/dev/null 2>&1 \
	      && echo OK || { echo "❌ (docker compose logs hermes)"; fail=1; }; \
	  else echo "skip (컨테이너에 curl 없음 — running 상태로 갈음)"; fi; \
	  printf "   orchestrator /sources  : "; \
	  curl -fs -m 5 http://127.0.0.1:8765/sources >/dev/null 2>&1 \
	    && echo OK || { echo "❌ ($(SYSTEMD_ENV) systemctl --user status $(UNIT))"; fail=1; }; \
	  printf "   caddy https(localhost) : "; \
	  code=$$(curl -sk -m 5 -o /dev/null -w '%{http_code}' https://localhost/ 2>/dev/null || echo 000); \
	  case "$$code" in 401|200) echo "OK (HTTP $$code, basic-auth 게이트)";; *) echo "❌ (HTTP $$code — docker compose logs caddy)"; fail=1;; esac; \
	  [ "$$fail" = 0 ] || { echo "❌ 헬스체크 실패 — 위 항목 확인"; exit 1; }

# ── 종료 / 로그 ─────────────────────────────────────────────────────────────
down: compose-down
	@$(SYSTEMD_ENV) systemctl --user stop $(UNIT) 2>/dev/null || true
	@echo "✅ down 완료 (유닛은 enable 유지 → 재부팅 시 자동기동. 완전 제거는 make orchestrator-uninstall)"

logs:
	@$(COMPOSE) logs -f

logs-orch:
	@$(SYSTEMD_ENV) journalctl --user -fu $(UNIT)
