#!/usr/bin/env bash
# M0 첫 항목 — Hermes를 Docker로 띄우고 백엔드 경로를 검증한다.
# WSL2 안에서 deploy/ 디렉토리 기준으로 실행:  bash bringup.sh
set -uo pipefail
cd "$(dirname "$0")"

echo "== 0. 사전 점검 =="
docker --version >/dev/null 2>&1 || { echo "❌ Docker 없음 — WSL2에 Docker(엔진 또는 Desktop WSL 통합) 필요"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ 'docker compose' 플러그인 없음"; exit 1; }
[ -f .env ] || { echo "❌ .env 없음 — 'cp .env.example .env' 후 값 채우기"; exit 1; }
set -a; . ./.env; set +a
[ -n "${API_SERVER_KEY:-}" ] || { echo "❌ .env 의 API_SERVER_KEY 비어 있음 (openssl rand -hex 32)"; exit 1; }
export HERMES_UID="$(id -u)" HERMES_GID="$(id -g)"

echo "== 1. 데이터 디렉토리 =="
mkdir -p "$HOME/.hermes"
if [ ! -f "$HOME/.hermes/config.yaml" ]; then
  echo "⚠️  설정이 없습니다. 먼저 설정 마법사를 1회 실행하세요(프로바이더/모델/툴):"
  echo "    docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent setup"
  exit 1
fi

echo "== 2. hermes 컨테이너 기동 (caddy 제외) =="
docker compose up -d hermes
echo "   기동 대기..."; sleep 6

echo "== 3. hermes doctor =="
docker compose exec -T hermes hermes doctor || echo "⚠️ doctor 비정상 — 'docker compose logs hermes' 확인"

echo "== 4. OpenAI 호환 API 서버 응답 (/v1/models) =="
if docker compose exec -T hermes curl -fs -m 10 \
      -H "Authorization: Bearer ${API_SERVER_KEY}" \
      http://localhost:8642/v1/models >/tmp/hermes_models.json 2>/dev/null; then
  echo "✅ API 서버 응답 OK:"; head -c 400 /tmp/hermes_models.json; echo
else
  echo "❌ /v1/models 실패 — 확인: API_SERVER_ENABLED/KEY, 'docker compose logs hermes'"
fi

echo
echo "다음: 채팅 1회 스트리밍 테스트 →"
echo "  docker compose exec -T hermes curl -s -N http://localhost:8642/v1/chat/completions \\"
echo "    -H \"Authorization: Bearer \$API_SERVER_KEY\" -H 'Content-Type: application/json' \\"
echo "    -d '{\"model\":\"default\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"한 문장으로 인사해줘\"}]}'"
echo
echo "로그: docker compose logs -f hermes"
