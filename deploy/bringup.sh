#!/usr/bin/env bash
# 한 방 배포는 레포 루트의 Makefile로 통합됐다(배포 모델 A 하이브리드).
# 이 스크립트는 호환용 래퍼 — 레포 루트에서 `make up`을 실행한다.
#
#   make up    프론트 빌드 → 오케스트레이터(호스트 네이티브) → docker compose → 헬스체크
#   make down / make logs / make health / make orchestrator-uninstall
#
# 전제: Docker(+compose), deploy/.env(값 채움), ~/.hermes 설정 마법사 1회 완료.
set -uo pipefail
cd "$(dirname "$0")/.."
exec make up
