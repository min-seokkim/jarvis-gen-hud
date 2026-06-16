# Generative HUD 실전 테스트 질문 세트

> 목적: 음성 파이프라인(M5) 전에 HUD 생성·발명 품질을 다듬기 위한 테스트 배터리.
> 질문은 민석의 **실제 작업 맥락**(COBRA 레이더 업무 · SNU 솔라카 BWSC25 · 학사)에서 뽑았다 — 데모용 가짜 시나리오가 아니라 자비스가 실전에서 받을 질문.
> 사용법: 앱에 그대로 입력 → 각 질문의 **검증 포인트** 체크. 실패 시 envelope 원문 저장해 분석.

전제: Hermes는 워크스테이션에서 돌고 `E:\COBRA_Workspace`, `E:\COBRA_Archive`, `E:\SNU Solar EV Archive`, `E:\OneDrive\Documents` 접근 가능. 수치는 전부 deterministic 경로(terminal/파일)로 — LLM이 지어내면 실패.

---

## A. 회귀 — 이미 지원하는 live 소스 (M3·M5a 검증)

| # | 질문 | 기대 HUD | 데이터 경로 | 검증 포인트 |
|---|------|---------|------------|------------|
| A1 | "지금 프로젝트 빌드 상태 보여줘" | Steps + ProgressBar | `live: build_sim` | 보편 후크 회귀. 단계 진행·실패 단계 빨강 |
| A2 | "drone_detection 레포 상태 띄워줘" | StatusPanel + KeyValue + Badge | `live: project` (root=드론탐지 경로) | git 브랜치·dirty 파일 수가 실제 값과 일치 |
| A3 | "작업 드라이브 용량 얼마나 남았어?" | Gauge 또는 PieChart | `live: disk` (path=E:\) | 실측치 일치. 쓰기 중 게이지 갱신(라이브) |
| A4 | "방금 백그라운드로 돌린 프로세스 살아있는지 감시해줘" | StatusPanel + Badge | `live: proc_watch` (pid) | 프로세스 종료 시 상태 전환, HUD는 정적 유지 |

## B. HUD 발명 — COBRA 레이더 업무 (본 적 없는 작업)

| # | 질문 | 기대 HUD | 데이터 경로 | 검증 포인트 |
|---|------|---------|------------|------------|
| B1 | "세이버 SAR 처리 파이프라인 단계 보여줘 — 파싱부터 OMP까지 어디까지 됐는지" | Steps + StatusPanel | `sabre/cli/run_*.py` 산출물 존재 여부 (터미널) | 파이프라인 단계를 cli 구조(parser→multilook→omp/ar/sr3)에서 유추하는가 |
| B2 | "OMP 패치 사이즈 벤치마크 결과 비교해줘" | Chart (bar) + Stat | `benchmarks/benchmark_omp_patch_sizes.py` 결과 파일 | 결과 파일 없으면 수치 발명 금지 — "실행 필요" 안내가 정답 |
| B3 | "sabre 테스트 스위트 돌리고 결과 정리해줘" | Steps → StatusPanel + Stat (pass/fail) | `pytest` 실행 (터미널) | 실행 중 상태 표시, 실패 테스트 critical 강조 |
| B4 | "COBRA 아카이브 raw_data 뭐가 용량 제일 커?" | PieChart + KeyValue | `du` (터미널) | drone_mat/sar_h5/sar_mat/sar_sicd 실측 분포 |
| B5 | "도플러 스펙트럼 어떻게 생겼는지 보여줘" (drone_mat 측정 데이터) | Waveform | .mat 로드 스크립트 (터미널) | Waveform 프리미티브 첫 실전 사용. 못 그리면 우아한 폴백 |
| B6 | "Progress Report 마지막으로 쓴 게 언제야? 다음 보고까지 정리해줘" | KeyValue + Alert | `work_log/` 파일명·mtime | 파일명 날짜(20260213) 파싱, 수치 환각 없음 |

## C. HUD 발명 — 솔라카 BWSC25 (텔레메트리 도메인)

| # | 질문 | 기대 HUD | 데이터 경로 | 검증 포인트 |
|---|------|---------|------------|------------|
| C1 | "솔라카 텔레메트리 로그에서 배터리 상태 요약해줘" | Gauge (SOC%) + KeyValue (V/A/Temp) + Alert | 텔레메트리 CSV 파싱 (실제 필드: `SOC (%)`, `Battery Voltage (V)`, `Battery Temp (°C)`) | 실제 CSV 헤더와 매핑되는가. 임계 초과 시 caution/critical |
| C2 | "주행 로그에서 모터 온도랑 속도 추이 같이 띄워줘" | Chart (2계열) | CSV `Motor Temp (°C)`, `Speed (km/h)` | 시계열 다운샘플링, 축 단위 표기 |
| C3 | "MPPT 3개 출력 비교해줘" | Chart (bar) 또는 Stat ×3 | CSV `MPPT1~3 Power Out` | 합계=`MPPT Total`과 일치(계산 검증) |
| C4 | "다이나믹 스크러티니어링 절차 체크리스트로 만들어줘" | Steps (checklist) | PDF(46_2025-TEAM-NOTICE) — 문서 요약 | 정량 데이터 없는 **문서 기반 HUD** — 텍스트 출처 명시 |
| C5 | "배터리 스펙이랑 충전기 스펙 호환되는지 보여줘" | KeyValue 대비표 + Badge | Battery/Charger Spec PDF (138.6Vdc·12A vs 50S Li-Ion) | 두 문서 수치 대조, 판정 근거 표시 |

## D. 학사·일정 (가벼운 맥락 전환)

| # | 질문 | 기대 HUD | 데이터 경로 | 검증 포인트 |
|---|------|---------|------------|------------|
| D1 | "기말 프로젝트 마감까지 뭐 남았지?" | Steps + Alert (D-day) | term_project git log·briefs | 자기 자신(이 레포)을 읽는 재귀 케이스 |
| D2 | "이번 학기 듣는 과목 정리해줘" | KeyValue + Badge | `Documents/SNU_2026_Spring/` 폴더 구조 | 폴더명(FE·공기사·생실)에서 추론, 과장 금지 |

## E. 엣지·스트레스 — 다듬기의 핵심

| # | 질문 | 기대 동작 | 검증 포인트 |
|---|------|----------|------------|
| E1 | "sabre 테스트 커버리지 몇 퍼센트야?" (측정한 적 없음) | 수치 발명 **금지** — 측정 명령 제안 또는 모름 선언 | **수치 환각 유도 테스트.** 그럴듯한 % 만들면 실패 |
| E2 | "주식 시세 실시간으로 보여줘" (등록되지 않은 소스) | 알 수 없는 live 소스 → `live: null` 또는 `unknown_source` → 정적 HUD·앱 생존 | M5a 안전망 회귀. GPU는 이제 `gpu` command 소스로 등록됨(`orchestrator/sources/dynamic/gpu.json`) — 더 이상 unknown 케이스 아님 |
| E3 | "아무거나 멋진 거 띄워봐" | label-only 발명 거부 (M4 회귀) | 의미 없는 장식 HUD 생성하면 실패 |
| E4 | "고마워, 잘했어" | HUD **없음** — 음성/텍스트만 | 모든 입력에 HUD를 강요하지 않는 판단 |
| E5 | (C1 직후) "방금 그거 게이지를 퍼센트 말고 전압으로 바꿔줘" | 같은 HUD 수정 재생성 | 세션 연속성(M4b) — 직전 envelope 참조 |
| E6 | "배터리 상태랑 빌드 진행 둘 다 보여줘" | 단일 envelope 내 합리적 합성 또는 우선순위 판단 | M4c single-self 제약 하 복합 요청 처리 |
| E7 | "Show me the disk usage breakdown of COBRA archive" | B4와 동일 품질 | 영어 입력에도 동일 스코프 준수 |
| E8 | (오케스트레이터 죽인 뒤) A3 재질문 | 정적 HUD + `caution` | WS 다운 폴백 회귀 |

---

## 프리미티브 커버리지

| 프리미티브 | 커버 질문 |
|---|---|
| Panel/StatusPanel | A1·A2·A4·B1·B3 |
| ProgressBar | A1 |
| Gauge | A3·C1 |
| PieChart | A3·B4 |
| Stat | B2·B3·C3 |
| Steps | A1·B1·B3·C4·D1 |
| Chart | B2·C2·C3 |
| Waveform | **B5** (유일 — 우선 테스트) |
| Alert | B6·C1·D1 |
| Badge | A2·A4·C5·D2 |
| KeyValue | A2·B4·B6·C1·C5·D2 |
| live 필드 | A1–A4·E2·E8 |

권장 순서: **A(회귀) → E1–E4(안전망) → B/C에서 5개 골라 발명 품질 → E5–E8**. 전부 할 필요 없음 — 실패한 것만 고치고 재실행.
