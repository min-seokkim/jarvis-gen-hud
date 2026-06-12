import type { ReactNode } from 'react';
import type { State, StepStatus } from './types';

export interface PanelProps {
  title?: string;
  state?: State;
  children: ReactNode;
  span?: 1 | 2 | 3;
}

export interface StatusPanelProps {
  label: string;
  value: string;
  state: State;
  hint?: string;
}

export interface ProgressBarProps {
  value?: number;
  label?: string;
  state?: State;
  showPct?: boolean;
}

export interface GaugeProps {
  value?: number;
  min?: number;
  max?: number;
  unit?: string;
  label?: string;
  state?: State;
}

export interface PieChartProps {
  slices?: PieSlice[];
  data?: PieSlice[];
  label?: string;
  state?: State;
}

export interface StatProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  state?: State;
}

export interface StepsProps {
  steps?: StepItem[];
  items?: StepItem[];
  data?: StepItem[];
}

export interface ChartProps {
  kind?: 'line' | 'bar' | 'area';
  data?: { x: string | number; y: number }[];
  points?: { x: string | number; y: number }[];
  unit?: string;
  label?: string;
  state?: State;
}

export interface WaveformProps {
  samples?: number[];
  data?: number[];
  label?: string;
  state?: State;
}

export interface AlertProps {
  severity: State;
  title: string;
  message?: string;
}

export interface BadgeProps {
  text: string;
  state?: State;
}

export interface KeyValueProps {
  items?: { k?: string; v?: string; label?: string; value?: string }[];
  data?: { k?: string; v?: string; label?: string; value?: string }[];
}

const DEFAULT_STATE: State = 'info';
const SERIES_PALETTE_SIZE = 5;

type PieSlice = {
  label?: string;
  name?: string;
  value?: number;
  state?: State;
};

type StepItem = {
  name?: string;
  label?: string;
  status?: StepStatus;
  state?: State;
  description?: string;
};

export function Panel({
  title,
  state = DEFAULT_STATE,
  children,
  span = 1,
}: PanelProps) {
  return (
    <section
      className={`hud-panel hud-state-${state} hud-panel--span-${span}`}
    >
      {title && <div className="hud-panel-title">{title}</div>}
      <div className="hud-panel-body">{children}</div>
    </section>
  );
}

export function StatusPanel({ label, value, state, hint }: StatusPanelProps) {
  return (
    <div className={`hud-status-panel hud-state-${state}`}>
      <div className="hud-label">{label}</div>
      <div className="hud-status-value">{value}</div>
      {hint && <div className="hud-hint">{hint}</div>}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  state = DEFAULT_STATE,
  showPct = false,
}: ProgressBarProps) {
  const normalized = toPercent(value ?? 0);
  const ticks = [0, 25, 50, 75, 100];

  return (
    <div className={`hud-progress hud-state-${state}`}>
      {(label || showPct) && (
        <div className="hud-progress-head">
          {label && <span>{label}</span>}
          {showPct && <span>{Math.round(normalized)}%</span>}
        </div>
      )}
      <progress value={normalized} max={100} aria-label={label} />
      <div className="hud-progress-scale" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ insetInlineStart: `${tick}%` }} />
        ))}
      </div>
    </div>
  );
}

export function Gauge({
  value,
  min = 0,
  max = 100,
  unit,
  label,
  state = DEFAULT_STATE,
}: GaugeProps) {
  const displayValue = Number.isFinite(value) ? Number(value) : min;
  const pct = normalize(displayValue, min, max);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);
  const pointer = gaugePointer(pct);

  return (
    <div className={`hud-gauge hud-state-${state}`}>
      <svg viewBox="0 0 120 120" role="img" aria-label={label}>
        <g className="hud-gauge-ticks" aria-hidden="true">
          {gaugeTicks(16).map((tick) => (
            <line
              key={tick.index}
              className={tick.major ? 'is-major' : undefined}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
            />
          ))}
        </g>
        <circle className="hud-gauge-track" cx="60" cy="60" r={radius} />
        <circle
          className="hud-gauge-fill"
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
        />
        <line
          className="hud-gauge-pointer"
          x1={pointer.x1}
          y1={pointer.y1}
          x2={pointer.x2}
          y2={pointer.y2}
        />
      </svg>
      <div className="hud-gauge-readout">
        <span>{displayValue}</span>
        {unit && <small>{unit}</small>}
      </div>
      {label && <div className="hud-label">{label}</div>}
    </div>
  );
}

export function PieChart({
  slices,
  data,
  label,
  state = DEFAULT_STATE,
}: PieChartProps) {
  const safeSlices = asArray(slices ?? data)
    .map((slice, index) => ({
      label: slice.label ?? slice.name ?? `Slice ${index + 1}`,
      value: Number.isFinite(slice.value) ? Number(slice.value) : 0,
      state: slice.state,
    }))
    .filter((slice) => slice.value > 0)
    // State colors carry meaning (caution/critical are warnings), so slices
    // without an explicit state get a neutral series palette instead.
    .map((slice, index) => ({
      ...slice,
      tone: slice.state
        ? `hud-state-${slice.state}`
        : `hud-series-${index % SERIES_PALETTE_SIZE}`,
    }));
  const total = safeSlices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;

  if (total <= 0 || safeSlices.length === 0) {
    return <div className="hud-empty">No slices</div>;
  }

  const segments = safeSlices.map((slice, index) => {
    const previousTotal = safeSlices
      .slice(0, index)
      .reduce((sum, previous) => sum + previous.value, 0);
    const length = (slice.value / total) * circumference;
    const dashOffset = -(previousTotal / total) * circumference;

    return {
      ...slice,
      length,
      dashOffset,
      remainder: circumference - length,
      pct: Math.round((slice.value / total) * 100),
    };
  });

  return (
    <div className={`hud-pie hud-state-${state}`}>
      {label && <div className="hud-label">{label}</div>}
      <div className="hud-pie-body">
        <svg viewBox="0 0 120 120" role="img" aria-label={label}>
          <g className="hud-pie-radar" aria-hidden="true">
            <circle cx="60" cy="60" r="18" />
            <circle cx="60" cy="60" r="38" />
            <path d="M60 18 V102 M18 60 H102 M30 30 L90 90 M90 30 L30 90" />
          </g>
          <circle className="hud-pie-track" cx="60" cy="60" r={radius} />
          {segments.map((slice, index) => (
            <circle
              key={`${index}-${slice.label}`}
              className={`hud-pie-segment ${slice.tone}`}
              cx="60"
              cy="60"
              r={radius}
              strokeDasharray={`${slice.length} ${slice.remainder}`}
              strokeDashoffset={slice.dashOffset}
            />
          ))}
          <circle className="hud-pie-core" cx="60" cy="60" r="24" />
          <text className="hud-pie-total" x="60" y="62">
            {safeSlices.length}
          </text>
        </svg>
        <dl className="hud-pie-legend">
          {segments.map((slice, index) => (
            <div key={`${index}-${slice.label}`}>
              <dt className={slice.tone}>
                <span aria-hidden="true" />
                {slice.label}
              </dt>
              <dd>{slice.pct}%</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  delta,
  state = DEFAULT_STATE,
}: StatProps) {
  const numericDelta = typeof delta === 'number' ? delta : undefined;

  return (
    <div className={`hud-stat hud-state-${state}`}>
      <div className="hud-label">{label}</div>
      <div className="hud-stat-value">
        <span>{value}</span>
        {unit && <small>{unit}</small>}
      </div>
      {numericDelta !== undefined && (
        <div className={`hud-delta ${numericDelta >= 0 ? 'is-up' : 'is-down'}`}>
          {numericDelta >= 0 ? '+' : ''}
          {numericDelta}
        </div>
      )}
    </div>
  );
}

export function Steps({ steps, items, data }: StepsProps) {
  const safeSteps = asArray(steps ?? items ?? data);

  if (safeSteps.length === 0) {
    return <div className="hud-empty">No steps</div>;
  }

  return (
    <ol className="hud-steps">
      {safeSteps.map((step, index) => {
        const name = step.name ?? step.label ?? 'Untitled step';
        const status = normalizeStepStatus(step.status ?? step.state);

        return (
          <li key={`${index}-${name}`} className={`is-${status}`}>
            <span className="hud-step-dot" aria-hidden="true" />
            <span>{name}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Chart({
  kind = 'line',
  data,
  points: pointData,
  unit,
  label,
  state = DEFAULT_STATE,
}: ChartProps) {
  const entries = asArray(data ?? pointData);
  const points = chartPoints(entries);
  const baselineY = chartBaselineY(entries.map((point) => point.y));

  return (
    <div className={`hud-chart hud-state-${state}`}>
      {(label || unit) && (
        <div className="hud-chart-head">
          {label && <span>{label}</span>}
          {unit && <span>{unit}</span>}
        </div>
      )}
      {points.length === 0 ? (
        <div className="hud-empty">No data</div>
      ) : (
        <svg viewBox="0 0 160 72" role="img" aria-label={label}>
          <path className="hud-chart-grid" d="M0 18 H160 M0 36 H160 M0 54 H160" />
          <path className="hud-chart-axis" d="M8 8 V64 H152" />
          {kind === 'bar' ? (
            points.map((point, index) => (
              <rect
                key={`${point.x}-${point.y}-${index}`}
                className="hud-chart-bar"
                x={point.x - point.barWidth / 2}
                y={Math.min(point.y, baselineY)}
                width={point.barWidth}
                height={Math.max(1, Math.abs(baselineY - point.y))}
                rx="2"
              />
            ))
          ) : (
            <>
              {kind === 'area' && (
                <path
                  className="hud-chart-area"
                  d={`${linePath(points)} L ${points[points.length - 1].x} 72 L ${points[0].x} 72 Z`}
                />
              )}
              <path className="hud-chart-line" d={linePath(points)} />
              <g className="hud-chart-points">
                {points.map((point, index) => (
                  <circle
                    key={`${point.x}-${point.y}-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r="2.4"
                  />
                ))}
              </g>
            </>
          )}
          <g className="hud-chart-xlabels" aria-hidden="true">
            <text x="8" y="71">
              {String(entries[0].x)}
            </text>
            {entries.length > 1 && (
              <text x="152" y="71" textAnchor="end">
                {String(entries[entries.length - 1].x)}
              </text>
            )}
          </g>
        </svg>
      )}
    </div>
  );
}

export function Waveform({
  samples,
  data,
  label,
  state = DEFAULT_STATE,
}: WaveformProps) {
  const points = waveformPoints(asArray(samples ?? data));

  return (
    <div className={`hud-waveform hud-state-${state}`}>
      {label && <div className="hud-label">{label}</div>}
      {points ? (
        <svg viewBox="0 0 160 56" role="img" aria-label={label}>
          <path className="hud-waveform-band" d="M0 14 H160 M0 42 H160" />
          <path className="hud-waveform-mid" d="M0 28 H160" />
          <polyline className="hud-waveform-line" points={points} />
        </svg>
      ) : (
        <div className="hud-empty">No samples</div>
      )}
    </div>
  );
}

export function Alert({ severity, title, message }: AlertProps) {
  return (
    <div className={`hud-alert hud-state-${severity}`}>
      <strong>{title}</strong>
      {message && <span>{message}</span>}
    </div>
  );
}

export function Badge({ text, state = DEFAULT_STATE }: BadgeProps) {
  return <span className={`hud-badge hud-state-${state}`}>{text}</span>;
}

export function KeyValue({ items, data }: KeyValueProps) {
  const safeItems = asArray(items ?? data);

  if (safeItems.length === 0) {
    return <div className="hud-empty">No items</div>;
  }

  return (
    <dl className="hud-key-value">
      {safeItems.map((item, index) => (
        <div key={`${index}-${item.k ?? item.label}`}>
          <dt>{item.k ?? item.label}</dt>
          <dd>{item.v ?? item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function toPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 100);
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface ChartPoint {
  x: number;
  y: number;
  barWidth: number;
}

function chartPoints(data: ChartProps['data']): ChartPoint[] {
  if (!data || data.length === 0) return [];

  const values = data.map((point) => point.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = data.length === 1 ? 0 : 144 / (data.length - 1);
  const barWidth = clamp(112 / data.length, 5, 18);

  return data.map((point, index) => ({
    x: 8 + step * index,
    y: 64 - ((point.y - min) / range) * 56,
    barWidth,
  }));
}

function chartBaselineY(values: number[]): number {
  if (values.length === 0) return 64;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min >= 0) return 64;
  if (max <= 0) return 8;
  return 64 - ((0 - min) / (max - min)) * 56;
}

function gaugeTicks(count: number): {
  index: number;
  major: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = ((index / count) * 360 - 90) * (Math.PI / 180);
    const major = index % 4 === 0;
    const outer = 54;
    const inner = major ? 47 : 50;
    return {
      index,
      major,
      x1: 60 + Math.cos(angle) * inner,
      y1: 60 + Math.sin(angle) * inner,
      x2: 60 + Math.cos(angle) * outer,
      y2: 60 + Math.sin(angle) * outer,
    };
  });
}

function gaugePointer(pct: number): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const angle = (pct * 360 - 90) * (Math.PI / 180);
  return {
    x1: 60 + Math.cos(angle) * 38,
    y1: 60 + Math.sin(angle) * 38,
    x2: 60 + Math.cos(angle) * 54,
    y2: 60 + Math.sin(angle) * 54,
  };
}

function linePath(points: ChartPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

function waveformPoints(samples: number[]): string | undefined {
  if (samples.length === 0) return undefined;

  const max = Math.max(...samples.map((sample) => Math.abs(sample))) || 1;
  const step = samples.length === 1 ? 0 : 160 / (samples.length - 1);

  return samples
    .map((sample, index) => {
      const x = step * index;
      const y = 28 - (sample / max) * 22;
      return `${x},${y}`;
    })
    .join(' ');
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStepStatus(status: StepItem['status'] | StepItem['state']): StepStatus {
  if (status === 'stable') return 'done';
  if (status === 'info') return 'active';
  if (status === 'caution') return 'active';
  if (status === 'critical') return 'failed';
  if (status === 'done' || status === 'active' || status === 'pending' || status === 'failed') {
    return status;
  }
  return 'pending';
}
