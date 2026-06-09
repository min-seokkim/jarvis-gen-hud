import { useContext, useEffect, useMemo, type ReactNode } from 'react';
import { LiveContext, LiveError, LivePreview, LiveProvider } from 'react-live';
import {
  Alert,
  Badge,
  Chart,
  Gauge,
  KeyValue,
  Panel,
  ProgressBar,
  Stat,
  StatusPanel,
  Steps,
  Waveform,
} from '../hud';
import type { HudData } from '../lib/hudData';

export type HudPhase = 'idle' | 'generating' | 'rendered' | 'error';

export interface HudRenderState {
  phase: HudPhase;
  jsx?: string;
  data?: HudData;
  message?: string;
  repairCount?: number;
}

interface Props {
  hud: HudRenderState;
  onRenderError: (message: string) => void;
}

export function HudCanvas({ hud, onRenderError }: Props) {
  const scope = useMemo(
    () => ({
      Alert,
      Badge,
      Chart,
      Gauge,
      KeyValue,
      Panel,
      ProgressBar,
      Stat,
      StatusPanel,
      Steps,
      Waveform,
      data: hud.data,
    }),
    [hud.data],
  );

  return (
    <section className="panel" aria-label="HUD 캔버스">
      <div className="panel-title">HUD 캔버스</div>
      <div className="hud-live-canvas" data-testid="hud-canvas">
        {hud.phase === 'idle' && <HudEmpty />}
        {hud.phase === 'generating' && (
          <HudSkeleton message={hud.message ?? 'HUD 생성 중'} />
        )}
        {hud.phase === 'error' && (
          <div className="hud-live-fallback" data-testid="hud-fallback">
            <Panel title="HUD fallback" state="critical">
              <Alert
                severity="critical"
                title="HUD render failed"
                message={hud.message ?? 'Unable to render generated HUD.'}
              />
            </Panel>
          </div>
        )}
        {hud.phase === 'rendered' && hud.jsx && hud.data && (
          <LiveProvider code={hud.jsx} scope={scope} language="tsx">
            <RenderErrorBridge onError={onRenderError} />
            <LivePreview Component={HudPreviewFrame} />
            <LiveError className="hud-live-error" data-testid="hud-live-error" />
          </LiveProvider>
        )}
      </div>
    </section>
  );
}

function HudPreviewFrame({ children }: { children?: ReactNode }) {
  return (
    <div className="hud-live-preview" data-testid="hud-live-preview">
      {children}
    </div>
  );
}

function RenderErrorBridge({ onError }: { onError: (message: string) => void }) {
  const live = useContext(LiveContext);

  useEffect(() => {
    if (live.error) onError(live.error);
  }, [live.error, onError]);

  return null;
}

function HudEmpty() {
  return (
    <div className="hud-placeholder" data-testid="hud-empty">
      <div className="reticle" aria-hidden="true" />
      <p>생성형 HUD 영역</p>
      <small>작업 맥락에 맞는 UI가 여기에 실시간 생성됩니다.</small>
    </div>
  );
}

function HudSkeleton({ message }: { message: string }) {
  return (
    <div className="hud-skeleton" data-testid="hud-skeleton" role="status">
      <div className="hud-skeleton-reticle" aria-hidden="true" />
      <div className="hud-skeleton-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{message}</p>
    </div>
  );
}
