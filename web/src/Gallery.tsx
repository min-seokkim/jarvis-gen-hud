import {
  Alert,
  Badge,
  Chart,
  Gauge,
  KeyValue,
  Panel,
  PieChart,
  ProgressBar,
  Stat,
  StatusPanel,
  Steps,
  Waveform,
  type Size,
  type State,
} from './hud';

const STATES: State[] = ['stable', 'info', 'caution', 'critical'];
const SIZES: Size[] = ['sm', 'md', 'lg'];

const STATE_COPY: Record<State, { label: string; value: string; hint: string }> =
  {
    stable: {
      label: 'stable',
      value: 'NOMINAL',
      hint: '파랑: 안정 상태',
    },
    info: {
      label: 'info',
      value: 'SYNC',
      hint: '청록: 일반 정보',
    },
    caution: {
      label: 'caution',
      value: 'CHECK',
      hint: '주황: 주의 필요',
    },
    critical: {
      label: 'critical',
      value: 'FAULT',
      hint: '빨강: 실패 또는 경고',
    },
  };

const buildSteps = [
  { name: 'Install deps', status: 'done' as const },
  { name: 'Typecheck', status: 'done' as const },
  { name: 'Build bundle', status: 'active' as const },
  { name: 'Deploy gate', status: 'pending' as const },
  { name: 'Smoke test', status: 'failed' as const },
];

const chartData = [
  { x: 'parse', y: 18 },
  { x: 'plan', y: 42 },
  { x: 'render', y: 35 },
  { x: 'heal', y: 54 },
  { x: 'ready', y: 76 },
];

const waveformSamples = [
  0.1, 0.6, -0.2, 0.9, -0.7, 0.25, 0.4, -0.45, 0.8, -0.1, 0.35, -0.8,
  0.2, 0.7, -0.35, 0.15,
];

// 촘촘한 도플러 스펙트럼(96 bin) — 정제 전엔 점 마커가 라인을 덮어 "구슬
// 목걸이"가 됐다. 결정적(no random) 데이터라 스냅샷/스크린샷 안정.
const denseSpectrum = Array.from({ length: 96 }, (_, i) => {
  const freq = Number((i * 0.0125).toFixed(4));
  const peakA = Math.exp(-((i - 28) ** 2) / 50) * 0.85;
  const peakB = Math.exp(-((i - 66) ** 2) / 24) * 0.55;
  const floor = 0.04 + 0.02 * Math.sin(i / 3);
  return { x: freq, y: Number((peakA + peakB + floor).toFixed(4)) };
});

const toolSteps = [
  { name: 'terminal', status: 'done' as const, description: 'df -h /' },
  {
    name: 'code_execution',
    status: 'done' as const,
    description: '{"path":"/","usedPct":1.2}',
  },
  { name: 'file', status: 'active' as const, description: 'reading package.json' },
];

const repoSlices = [
  { label: 'src', value: 48 },
  { label: 'tests', value: 22 },
  { label: 'docs', value: 14 },
  { label: 'config', value: 9 },
];

// Tier 1: heat 막대(값→--seq-*)와 categorical 분해(--cat-*) — 상태색과 별개 축.
const heatBars = [
  { x: 'init', y: 12 },
  { x: 'recon', y: 47 },
  { x: 'exploit', y: 88 },
  { x: 'c2', y: 63 },
  { x: 'exfil', y: 100 },
];

const attackCategories = [
  { label: 'Initial Access', value: 8 },
  { label: 'Execution', value: 14 },
  { label: 'Persistence', value: 5 },
  { label: 'Lateral Move', value: 11 },
  { label: 'Exfiltration', value: 3 },
  { label: 'Impact', value: 6 },
];

export function Gallery() {
  return (
    <div className="gallery-shell">
      <header className="gallery-header">
        <a href="/" className="gallery-back">
          J.A.R.V.I.S
        </a>
        <div>
          <h1>HUD Primitive Gallery</h1>
          <p>Design tokens and allowed components for generated HUD output.</p>
        </div>
        <div className="gallery-size-row" aria-label="size tokens">
          {SIZES.map((size) => (
            <Badge key={size} text={size} state="info" />
          ))}
        </div>
      </header>

      <main className="gallery-main">
        <section className="gallery-state-section">
          <div className="gallery-section-head">
            <Badge text="refinement" state="info" />
            <span>
              밀도 처리·축 라벨·숫자 포맷·Steps description·PieChart 총합
            </span>
          </div>

          <div className="hud-grid">
            <Panel title="Dense Doppler Spectrum (96 pt)" state="info" span={2}>
              <Chart
                kind="line"
                data={denseSpectrum}
                unit="mag"
                label="Range-Doppler bin magnitude"
                state="info"
              />
            </Panel>

            <Panel title="Steps + detail" state="info">
              <Steps steps={toolSteps} />
            </Panel>

            <Panel title="PieChart (center = total)" state="info">
              <PieChart
                slices={repoSlices}
                label="Repo composition"
                state="info"
              />
            </Panel>
          </div>
        </section>

        <section className="gallery-state-section">
          <div className="gallery-section-head">
            <Badge text="tier 1" state="info" />
            <span>
              비의미 팔레트: heat 막대(--seq-*) · categorical 파이(--cat-*) ·
              레이더 게이지
            </span>
          </div>

          <div className="hud-grid">
            <Panel title="Heat bars (값 → seq 램프)" state="info" span={2}>
              <Chart
                kind="bar"
                data={heatBars}
                unit="score"
                label="Kill-chain stage intensity"
                state="info"
              />
            </Panel>

            <Panel title="Categorical breakdown" state="info">
              <PieChart
                slices={attackCategories}
                label="Tactic categories"
                state="info"
              />
            </Panel>

            <Panel title="Radar gauge" state="info">
              <Gauge
                label="Signal"
                value={73}
                min={0}
                max={100}
                unit="%"
                state="info"
              />
            </Panel>
          </div>
        </section>

        {STATES.map((state) => (
          <section key={state} className="gallery-state-section">
            <div className="gallery-section-head">
              <Badge text={state} state={state} />
              <span>{STATE_COPY[state].hint}</span>
            </div>

            <div className="hud-grid">
              <Panel title="StatusPanel" state={state}>
                <StatusPanel
                  label={STATE_COPY[state].label}
                  value={STATE_COPY[state].value}
                  state={state}
                  hint={STATE_COPY[state].hint}
                />
              </Panel>

              <Panel title="ProgressBar + Gauge" state={state}>
                <ProgressBar
                  label="Build progress"
                  value={68}
                  state={state}
                  showPct
                />
                <Gauge
                  label="Confidence"
                  value={82}
                  min={0}
                  max={100}
                  unit="%"
                  state={state}
                />
              </Panel>

              <Panel title="Stat + Badge + KeyValue" state={state}>
                <Stat
                  label="Latency"
                  value={124}
                  unit="ms"
                  delta={state === 'critical' ? -18 : 7}
                  state={state}
                />
                <Badge text="primitive" state={state} />
                <KeyValue
                  items={[
                    { k: 'scope', v: 'hud' },
                    { k: 'source', v: 'props' },
                    { k: 'state', v: state },
                  ]}
                />
              </Panel>

              <Panel title="Build Status Demo" state={state} span={2}>
                <Steps steps={buildSteps} />
                <ProgressBar
                  label="Demo hook"
                  value={74}
                  state={state}
                  showPct
                />
              </Panel>

              <Panel title="Alert" state={state}>
                <Alert
                  severity={state}
                  title={`${state.toUpperCase()} signal`}
                  message="Fallback-ready message surface for generated HUDs."
                />
              </Panel>

              <Panel title="Chart" state={state} span={2}>
                <Chart
                  kind={state === 'stable' ? 'line' : state === 'info' ? 'area' : 'bar'}
                  data={chartData}
                  unit="ops"
                  label="Task telemetry"
                  state={state}
                />
              </Panel>

              <Panel title="Waveform" state={state}>
                <Waveform
                  samples={waveformSamples}
                  label="Voice envelope"
                  state={state}
                />
              </Panel>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
