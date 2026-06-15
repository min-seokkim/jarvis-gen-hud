# ADR 0004 — 음성(STT/TTS) 범위 제외

> 상태: **확정** · 날짜: 2026-06-15 · 관련: `0001-framework-hermes.md`, `docs/briefs/M5-hybrid-voice-routing.md`(historical), `README.md`, `docs/기획서.md`

## 맥락

- 제출 마감 임박(내일), 솔로. **평가 핵심 = generative HUD(React 프론트)** — AGENTS North Star: *"0부터 짓는 건 generative HUD 하나, 두뇌·음성·도구는 위임."*
- 음성(STT=faster-whisper, TTS=ElevenLabs, 음성 오케스트레이터 경로)은 처음부터 **위임/비핵심**이었고, 현재 **사실상 미구현 플레이스홀더**다 — 프론트의 마이크 버튼·`listening` 상태는 자리만, `orchestrator/`는 Live HUD 데이터 채널만 구현(음성 I/O 미연결).
- 라이브 데모에서 마이크·TTS는 **고빈도 실패 지점**(권한·장치·네트워크·지연).

## 결정

**음성(STT/TTS 및 음성 오케스트레이터 경로)을 이번 제출·데모 범위에서 제외한다.** 입력은 **텍스트 명령**으로 단일화하고, 음성은 **future work**로 둔다.

## 근거

- **North Star 일치** — 음성은 애초에 위임 영역. 제외해도 학술 기여(=generative HUD)에 영향 없음.
- **절단 비용 ≈ 0** — 미구현 플레이스홀더라 코어가 음성에 의존하지 않음(깔끔한 절단).
- **데모 리스크 제거** — 가장 흔한 라이브 사고 지점을 통째로 삭제.
- **시간 재배분** — 남은 하루를 평가 핵심(HUD 풍부화·anti-plain 정제)에 집중.

## 유지 (범위 제외와 무관 — 잘라내지 말 것)

- **Live HUD 오케스트레이터(`orchestrator/`)** = 음성 아님. generative HUD의 **라이브 데이터 채널**이므로 유지.
- **usher 즉답(TTFT)** = 음성 `say_now`에서 파생됐으나 **텍스트로도 동작** → 유지.
- **역할 하이브리드 라우팅**(브레인 config) 유지.
- **M5 브리프·음성 스파이크(`scripts/hermes_spike.py` 등)** = 삭제하지 않고 **future work 기록**으로 보존.

## 결과 (후속)

1. 프론트 음성 흔적(마이크 placeholder·`listening` 상태·StatusBar 매핑) 비노출 정리 → `docs/briefs/voice-trace-cleanup-handoff.md`(Claude Code).
2. `README.md`·`docs/기획서.md` 소개를 **"텍스트 명령 → 생성형 HUD"** 로 정렬, 음성은 future work 표기.
3. **재검토 조건:** 데모 이후 음성 경로(faster-whisper + ElevenLabs + 오케스트레이터)를 future work로 복원 가능. 본 결정은 *범위* 결정이지 *설계 폐기*가 아니다.
