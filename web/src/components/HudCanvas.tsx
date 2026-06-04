/**
 * 우측 HUD 캔버스 — M1은 placeholder.
 * 제약 JSX 생성·샌드박스 렌더는 M3에서 이 자리에 들어간다.
 */
export function HudCanvas() {
  return (
    <section className="panel" aria-label="HUD 캔버스">
      <div className="panel-title">HUD 캔버스</div>
      <div className="hud-placeholder">
        <div className="reticle" aria-hidden="true" />
        <p>생성형 HUD 영역</p>
        <small>작업 맥락에 맞는 UI가 여기에 실시간 생성됩니다 (M3).</small>
      </div>
    </section>
  );
}
