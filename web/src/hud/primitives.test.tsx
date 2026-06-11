import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chart, KeyValue, Steps, Waveform } from './primitives';

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
        <Chart points={[{ x: 'now', y: 1 }]} />
        <Waveform data={[0, 1, 0]} />
      </>,
    );

    expect(screen.getByText('Build bundle')).toBeInTheDocument();
    expect(screen.getByText('Generated label')).toBeInTheDocument();
    expect(screen.getByText('scope')).toBeInTheDocument();
    expect(screen.getByText('hud')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
});
