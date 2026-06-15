import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Alert,
  Badge,
  Chart,
  Gauge,
  KeyValue,
  PieChart,
  ProgressBar,
  Stat,
  Steps,
  Waveform,
} from './primitives';
import { formatNumber, formatTick } from './format';

describe('HUD primitives', () => {
  it('renders empty states instead of throwing when generated props are missing', () => {
    render(
      <>
        <Steps />
        <KeyValue />
        <Chart />
        <Waveform />
      </>,
    );

    expect(screen.getByText('No steps')).toBeInTheDocument();
    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('No samples')).toBeInTheDocument();
  });

  it('accepts common generated aliases for collection props', () => {
    render(
      <>
        <Steps
          items={[
            { name: 'Build bundle', status: 'active' },
            { label: 'Generated label', state: 'stable' },
          ]}
        />
        <KeyValue data={[{ k: 'scope', v: 'hud' }]} />
        <PieChart
          slices={[
            { label: 'Used', value: 14, state: 'caution' },
            { label: 'Free', value: 86, state: 'stable' },
          ]}
        />
        <Chart points={[{ x: 'now', y: 1 }]} />
        <Waveform data={[0, 1, 0]} />
      </>,
    );

    expect(screen.getByText('Build bundle')).toBeInTheDocument();
    expect(screen.getByText('Generated label')).toBeInTheDocument();
    expect(screen.getByText('scope')).toBeInTheDocument();
    expect(screen.getByText('hud')).toBeInTheDocument();
    expect(screen.getByText('Used')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  it('renders gauge, progress, stat, alert, and badge readouts', () => {
    render(
      <>
        <Gauge value={42} unit="%" label="Disk used" />
        <ProgressBar value={74} label="Build" showPct />
        <Stat label="Free space" value={120} unit="GB" delta={-3} />
        <Alert
          severity="critical"
          title="Build failed"
          message="Smoke test exited 1"
        />
        <Badge text="LIVE" state="info" />
      </>,
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('74%')).toBeInTheDocument();
    expect(screen.getByText('Free space')).toBeInTheDocument();
    expect(screen.getByText('-3')).toBeInTheDocument();
    expect(screen.getByText('Build failed')).toBeInTheDocument();
    expect(screen.getByText('Smoke test exited 1')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('uses categorical (non-semantic) colors for slices without an explicit state', () => {
    const { container } = render(
      <PieChart
        slices={[
          { label: 'src', value: 4 },
          { label: 'docs', value: 3 },
          { label: 'tests', value: 2 },
          { label: 'config', value: 1 },
        ]}
      />,
    );

    const segments = container.querySelectorAll('.hud-pie-segment');
    expect(segments).toHaveLength(4);
    segments.forEach((segment, index) => {
      const className = segment.getAttribute('class') ?? '';
      expect(className).toContain(`hud-cat-${index}`);
      expect(className).not.toMatch(/hud-state-(caution|critical)/);
    });
  });

  it('keeps explicit slice states as semantic colors', () => {
    const { container } = render(
      <PieChart
        slices={[
          { label: 'Used', value: 90, state: 'critical' },
          { label: 'Free', value: 10 },
        ]}
      />,
    );

    const segments = container.querySelectorAll('.hud-pie-segment');
    expect(segments[0].getAttribute('class')).toContain('hud-state-critical');
    expect(segments[1].getAttribute('class')).toContain('hud-cat-1');
  });

  it('anchors bar charts to the zero line and labels the x range', () => {
    const { container } = render(
      <Chart
        kind="bar"
        data={[
          { x: '10:00', y: -5 },
          { x: '10:30', y: 0 },
          { x: '11:00', y: 5 },
        ]}
      />,
    );

    const bars = [...container.querySelectorAll('.hud-chart-bar')];
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(Number(bar.getAttribute('height'))).toBeGreaterThan(0);
      expect(Number(bar.getAttribute('y'))).toBeGreaterThanOrEqual(0);
    }
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('11:00')).toBeInTheDocument();
  });

  it('does not collide keys for repeated step or slice names', () => {
    render(
      <>
        <Steps
          steps={[
            { name: 'Retry', status: 'done' },
            { name: 'Retry', status: 'done' },
          ]}
        />
        <PieChart
          slices={[
            { label: 'misc', value: 1 },
            { label: 'misc', value: 1 },
          ]}
        />
      </>,
    );

    expect(screen.getAllByText('Retry')).toHaveLength(2);
    expect(screen.getAllByText('misc')).toHaveLength(2);
  });
});

describe('HUD primitive refinement', () => {
  it('formatNumber: 끝 0 제거·유효숫자 캡·비유한값/문자열 안전', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(1234.5678)).toBe('1235');
    expect(formatNumber(0.49219, 3)).toBe('0.492');
    expect(formatNumber(0.000123)).toBe('1.23e-4');
    expect(formatNumber(Number.NaN)).toBe('');
    expect(formatNumber('137 GB')).toBe('137 GB');
  });

  it('formatTick: 숫자는 짧게, 카테고리 문자열은 그대로', () => {
    expect(formatTick(0.49219)).toBe('0.492');
    expect(formatTick('10:30')).toBe('10:30');
  });

  it('촘촘한 스펙트럼 Chart는 마커를 숨기고 라인/area만 그린다', () => {
    const dense = Array.from({ length: 64 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 4),
    }));
    const { container } = render(<Chart kind="line" data={dense} />);
    expect(container.querySelectorAll('.hud-chart-points circle')).toHaveLength(
      0,
    );
    expect(container.querySelector('.hud-chart-line')).not.toBeNull();
    expect(container.querySelector('.hud-chart-area')).not.toBeNull();
  });

  it('포인트가 적으면 마커를 유지한다', () => {
    const sparse = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 2 },
    ];
    const { container } = render(<Chart kind="line" data={sparse} />);
    expect(container.querySelectorAll('.hud-chart-points circle')).toHaveLength(
      3,
    );
  });

  it('Chart 축 라벨은 raw float가 아니라 formatTick로 표시한다', () => {
    render(
      <Chart
        kind="line"
        data={[
          { x: 0.49219, y: 0.1 },
          { x: 0.5, y: 0.9 },
        ]}
      />,
    );
    expect(screen.getByText('0.492')).toBeInTheDocument();
  });

  it('Steps는 description을 2차 라인으로 렌더한다', () => {
    render(
      <Steps steps={[{ name: 'scan', status: 'active', description: 'df -h /' }]} />,
    );
    expect(screen.getByText('scan')).toBeInTheDocument();
    expect(screen.getByText('df -h /')).toBeInTheDocument();
  });

  it('PieChart 중앙은 슬라이스 개수가 아니라 총합 값을 표시한다', () => {
    render(
      <PieChart
        slices={[
          { label: 'a', value: 30 },
          { label: 'b', value: 70 },
        ]}
      />,
    );
    expect(screen.getByText('100')).toBeInTheDocument();
  });
});

describe('HUD Tier1 — 비의미 색 팔레트(색축 보호)', () => {
  it('heat 막대는 값에 따라 sequential(--seq-*) 클래스를 받고 상태색을 침범하지 않는다', () => {
    const { container } = render(
      <Chart
        kind="bar"
        data={[
          { x: 'a', y: 0 },
          { x: 'b', y: 50 },
          { x: 'c', y: 100 },
        ]}
      />,
    );
    const bars = [...container.querySelectorAll('.hud-chart-bar')];
    expect(bars).toHaveLength(3);
    expect(bars[0].getAttribute('class')).toContain('hud-heat-0'); // 최소→cool
    expect(bars[2].getAttribute('class')).toContain('hud-heat-4'); // 최대→warm
    bars.forEach((bar) =>
      expect(bar.getAttribute('class')).not.toMatch(/hud-state-/),
    );
  });

  it('상태가 명시된 PieChart 슬라이스는 categorical이 아니라 state 색을 쓴다', () => {
    const { container } = render(
      <PieChart
        slices={[
          { label: 'crit', value: 1, state: 'critical' },
          { label: 'plain', value: 1 },
        ]}
      />,
    );
    const segments = container.querySelectorAll('.hud-pie-segment');
    expect(segments[0].getAttribute('class')).toContain('hud-state-critical');
    expect(segments[0].getAttribute('class')).not.toMatch(/hud-cat-/);
    expect(segments[1].getAttribute('class')).toContain('hud-cat-');
  });
});
