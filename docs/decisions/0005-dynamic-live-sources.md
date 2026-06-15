# ADR 0005 — 동적 live source (generalized live sources)

> 상태: 채택 · 날짜: 2026-06-16 · 선행: ADR 0001
> 대상: `orchestrator/sources/*` · `web/src/lib/{liveHud,hudGenerator}.ts` · `App.tsx`

## 맥락

live source가 3곳에 하드코딩돼 있었다 — `orchestrator/sources/registry.py`(빌트인 dict),
`web/src/lib/liveHud.ts`(`LIVE_HUD_SOURCES` 리터럴), `HUD_SYSTEM_PROMPT`(정적 스키마 문자열).
새 소스(예: GPU)를 추가하려면 3곳을 동시에 고쳐야 했다. 목표는 백엔드 정본 + 파생 구조로
일반화하고, 궁극적으로 Hermes가 어댑터를 **런타임에 합성**(manifest 파일 작성)할 수 있게 하는 것.

## 결정

- **백엔드 = 정본.** 소스는 `SourceDescriptor(id, kind, description, output_schema,
  params_schema, fetcher)`. `GET /sources`가 fetcher를 제외한 descriptor 목록을 노출.
- **제네릭 `command` kind.** manifest의 `argv`를 매 틱 실행 → stdout 파싱(csv/json/regex)
  → manifest의 `outputSchema`로 키가 고정된 JSON emit. **틱마다 LLM 호출 없음** —
  오케스트레이터가 결정적 루프를 돈다(LLM은 어댑터를 1회 합성할 뿐).
- **동적 manifest.** `orchestrator/sources/dynamic/<id>.json`. 요청마다 재스캔(핫리로드).
  빌트인 id는 동적 manifest로 덮어쓸 수 없다.
- **프론트/프롬프트 파생.** 앱 init 시 `/sources`를 fetch → allow-list와 HUD 프롬프트의
  live 섹션을 descriptor에서 조립. 오케스트레이터 다운 시 빌트인 descriptor로 폴백.
- **GPU = 첫 동적 소스.** `dynamic/gpu.json` (`nvidia-smi --query-gpu=...`).

## 트러스트 경계 (솔로-로컬 한정)

에이전트(Hermes)가 작성한 manifest를 호스트에서 반복 실행한다 = 사실상 LLM이 호스트
코드를 돌린다. 이는 **단일 사용자·로컬 데모** 기준에서만 수용한다. 멀티테넌트·공개 배포
부적합. 경계를 다음으로 묶는다:

- **관리 디렉터리 한정.** `dynamic/`의 manifest만 실행. HUD envelope·모델 출력의 raw 명령을
  직접 실행하지 않는다.
- **shell 미사용.** `create_subprocess_exec(*argv)` — argv 리스트, 셸 해석 없음.
- **틱 바운드.** 타임아웃(기본 2s, 1..10s clamp) + stdout 출력 캡. 타임아웃·비정상 종료·
  스폰 실패 → `caution` payload(예외 미발생, 채널 유지).
- **승인 게이트.** manifest `approved: false` → 실행 보류(`pending_approval` caution). 필드
  부재 = 승인(솔로-로컬 파일 존재 = 활성). Phase 2에서 승인 UI로 확장.

## 결과

- 새 소스 추가 = manifest 파일 1개(코드/프론트/프롬프트 수정 0). Hermes가 파일로 추가 가능.
- 결정성·환각 0 유지: 어댑터는 실제 값만 emit, HUD는 선언된 키만 참조.
- Phase 2(마감 후): Hermes 대화 중 합성+등록 흐름, 승인 게이트 UI, `script` kind.
