# M1 빌드 브리프 — 앱 셸 + Hermes 스트리밍 대화

> Cowork가 작성한 **Claude Code 핸드오프 스펙.** Claude Code는 `AGENTS.md`를 기준으로 이 브리프를 구현한다.
> 브랜치: `feature/app-shell` → `dev` PR. 관련 이슈: M1.

## 목표 (Exit 조건)
텍스트 명령을 입력하면 **Hermes의 토큰이 대화 패널에 실시간 스트리밍**되고, 화면이 폰/PC 반응형으로 동작한다. (음성·HUD 생성은 다음 마일스톤)

## 범위 (이번 작업에서 할 것)
1. **스캐폴딩** — `web/`에 Vite + React + TypeScript 앱 생성. ESLint/Prettier, `npm run dev/build/typecheck/lint` 동작.
2. **레이아웃 (반응형)**
   - 상태바(자비스 상태: 대기/청취/사고/렌더/경고 — 지금은 표시 자리만)
   - **대화 패널**(좌) + **HUD 캔버스 placeholder**(우)
   - 입력 바: 텍스트 입력(우선) + 마이크 버튼(자리만, 비활성)
   - PC = 좌우 분할, 모바일 = 세로 스택/탭 전환
3. **Hermes 스트리밍 대화**
   - Hermes의 OpenAI 호환 `/v1/chat/completions`를 **SSE 스트리밍**으로 호출
   - 토큰을 받는 즉시 대화 패널에 누적 렌더(타이핑되듯)
   - 로딩/에러 상태 처리(에러 시 앱이 죽지 않게)
4. **자비스 톤 최소 적용** — 청록/검정 기조만 살짝. **본격 디자인 시스템은 M2**라 여기선 토큰 과투자 금지.

## 제약 (AGENTS.md 준수)
- TypeScript. 함수형 컴포넌트.
- **키를 프론트 번들에 넣지 않는다.** 개발 환경에선 **Vite dev 프록시**로 `/v1`을 `http://localhost:8642`에 넘기며 `Authorization: Bearer`를 프록시 단에서 주입(키는 `web/.env.local`, **커밋 금지** — `.gitignore` 확인). 배포는 Caddy가 동일 역할.
- 외부 라이브러리 임의 추가 금지 — 특히 **스트리밍 구현은 결정 필요**(아래).
- 수정/추가는 작은 커밋으로, 한 PR = 이 기능 단위.

## 결정 필요 (구현 전에 정할 것)
- **SSE 스트리밍 방식:** (a) `openai` JS SDK 사용(편하지만 의존성 추가) vs (b) `fetch` + `ReadableStream` 직접 파싱(무의존성). → 무의존 (b) 권장하나, Claude Code가 장단점 한 줄씩 제시 후 택1.
- **상태관리:** 지금 규모면 React state로 충분(전역 상태 라이브러리 미도입).

## 검증 (완료 선언 전)
- `npm run build` + `npm run typecheck` 에러 0.
- dev 서버에서 실제 렌더 + 텍스트 입력 → 토큰 스트리밍 확인(스크린샷 권장).
- **키 노출 점검:** 빌드 산출물/네트워크 탭에 `API_SERVER_KEY`가 없는지 확인(프록시로만 주입).
- 잘못된 입력/네트워크 에러에 앱이 죽지 않고 에러 상태 표시.
- 모바일 폭(≤480px)과 PC 폭에서 레이아웃 깨지지 않음.

## 비범위 (이번엔 하지 않음)
- generative HUD(제약 JSX 생성·샌드박스) → M3
- 디자인 토큰/프리미티브 체계 → M2
- 음성 파이프라인 → M5

---

### Claude Code에 붙여넣을 프롬프트 (패턴 A)
```
[맥락] AGENTS.md와 docs/기획서.md를 먼저 읽어. 우리는 generative HUD 자비스를 만든다.
       이번엔 그 토대인 "앱 셸 + Hermes 스트리밍 대화"만 만든다(브리프: docs/briefs/M1-app-shell.md).
[목표] web/에 Vite+React+TS 스캐폴딩 → 반응형 레이아웃(상태바 + 대화 패널 + HUD 캔버스 placeholder + 입력바)
       → Hermes OpenAI 호환 /v1/chat/completions를 SSE 스트리밍으로 붙여 토큰이 대화 패널에 실시간 표시.
[제약] TS. 키는 프론트에 안 넣음 — dev는 Vite 프록시로 localhost:8642에 Authorization 주입(키는 web/.env.local, 커밋 금지).
       외부 라이브러리 추가는 먼저 물어볼 것. 스트리밍은 fetch+ReadableStream 직접 vs openai SDK 중 택1을 장단점과 함께 제안 후 진행.
[출력] feature/app-shell 브랜치에 작은 커밋들로. 끝나면 build/typecheck 통과 + dev 렌더 스크린샷 + 키 미노출 확인 보고.
[검증] 브리프의 "검증" 체크리스트를 네가 먼저 통과시키고 결과를 보고해.
```
