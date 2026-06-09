import type { StepStatus } from '../hud';

export interface BuildStatusData {
  progress: number;
  steps: { name: string; status: StepStatus }[];
}

export interface HudData {
  build: BuildStatusData;
  errorMessage?: string;
}

export function getBuildStatus(): BuildStatusData {
  return {
    progress: 74,
    steps: [
      { name: 'Install deps', status: 'done' },
      { name: 'Typecheck', status: 'done' },
      { name: 'Build bundle', status: 'active' },
      { name: 'Deploy gate', status: 'pending' },
      { name: 'Smoke test', status: 'failed' },
    ],
  };
}

export function getHudData(): HudData {
  return {
    build: getBuildStatus(),
  };
}

export function describeHudDataShape(data: HudData): string {
  const stepStatuses = data.build.steps
    .map((step) => `${step.name}:${step.status}`)
    .join(', ');

  return [
    'data shape:',
    '- data.build.progress: number (0..100)',
    '- data.build.steps: Array<{ name: string; status: "done" | "active" | "pending" | "failed" }>',
    `Current deterministic step status labels for context only: ${stepStatuses}`,
    'Use data.build.progress and data.build.steps directly. Do not copy numeric values into JSX.',
  ].join('\n');
}
