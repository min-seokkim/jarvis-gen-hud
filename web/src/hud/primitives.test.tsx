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

  it('uses neutral series colors for slices without an explicit state', () => {
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
      expect(className).toContain(`hud-series-${index}`);
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
    expect(segments[1].getAttribute('class')).toContain('hud-series-1');
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
