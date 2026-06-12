import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Panel } from '../hud';
import type { HudData } from '../lib/hudData';
import type { HudDesign } from '../lib/hudGenerator';
import type { LiveHudSpec } from '../lib/liveHud';
import {
  isHudFrameStatusMessage,
  type HudFrameRenderMessage,
} from '../lib/hudFrameProtocol';

export type HudPhase = 'idle' | 'generating' | 'rendered' | 'error';

export interface HudRenderState {
  phase: HudPhase;
  jsx?: string;
  design?: HudDesign | null;
  live?: LiveHudSpec | null;
  liveStatus?: 'connected' | 'disconnected' | 'ended';
  data?: HudData;
  message?: string;
  repairCount?: number;
}

interface Props {
  hud: HudRenderState;
  onRenderError: (message: string) => void;
}

const HUD_FRAME_URL = '/hud-frame.html';
const FRAME_BOOT_TIMEOUT_MS = 8_000;
const FRAME_RENDER_TIMEOUT_MS = 5_000;
const MIN_FRAME_HEIGHT = 160;
const MAX_FRAME_HEIGHT = 2_400;

export function HudCanvas({ hud, onRenderError }: Props) {
  return (
    <section className="panel" aria-label="HUD 캔버스">
      <div className="panel-title">HUD 캔버스</div>
      <div className="hud-live-canvas" data-testid="hud-canvas">
        {hud.phase === 'idle' && <HudEmpty />}
        {hud.phase === 'generating' && (
          <HudSkeleton message={hud.message ?? 'HUD 생성 중'} />
        )}
        {hud.phase === 'error' && (
          <HudFallback
            message={hud.message ?? 'Unable to render generated HUD.'}
          />
        )}
        {hud.phase === 'rendered' && hud.jsx && hud.data && (
          <HudFrame
            jsx={hud.jsx}
            data={hud.data}
            onRenderError={onRenderError}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Hosts the generated HUD in an opaque-origin sandboxed iframe
 * (public/hud-frame.html). Generated code never executes in this document:
 * the frame has no same-origin access, and its CSP blocks all network I/O.
 * Render status flows back over postMessage; a watchdog converts a silent
 * frame into the normal repair path.
 */
function HudFrame({
  jsx,
  data,
  onRenderError,
}: {
  jsx: string;
  data: HudData;
  onRenderError: (message: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const watchdogRef = useRef<number | null>(null);
  const payloadRef = useRef<HudFrameRenderMessage>({
    type: 'hud:render',
    jsx,
    data,
  });
  const onRenderErrorRef = useRef(onRenderError);
  const [height, setHeight] = useState(MIN_FRAME_HEIGHT);
  const [bootFailed, setBootFailed] = useState(false);

  // Keep these refs in sync before the postRender effect below runs;
  // effects run in declaration order.
  useEffect(() => {
    payloadRef.current = { type: 'hud:render', jsx, data };
  }, [jsx, data]);

  useEffect(() => {
    onRenderErrorRef.current = onRenderError;
  }, [onRenderError]);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const postRender = useCallback(() => {
    // Opaque-origin frames can only be addressed with targetOrigin '*';
    // the payload contains no secrets (generated JSX + tool data).
    iframeRef.current?.contentWindow?.postMessage(payloadRef.current, '*');
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = null;
      onRenderErrorRef.current('HUD frame render timed out.');
    }, FRAME_RENDER_TIMEOUT_MS);
  }, [clearWatchdog]);

  useEffect(() => {
    const bootTimer = window.setTimeout(() => {
      if (!readyRef.current) setBootFailed(true);
    }, FRAME_BOOT_TIMEOUT_MS);
    return () => window.clearTimeout(bootTimer);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message: unknown = event.data;
      if (!isHudFrameStatusMessage(message)) return;

      if (message.type === 'hud:ready') {
        readyRef.current = true;
        postRender();
      } else if (message.type === 'hud:rendered') {
        clearWatchdog();
      } else if (message.type === 'hud:error') {
        clearWatchdog();
        onRenderErrorRef.current(message.message);
      } else {
        setHeight(
          Math.min(
            MAX_FRAME_HEIGHT,
            Math.max(MIN_FRAME_HEIGHT, Math.ceil(message.height)),
          ),
        );
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      clearWatchdog();
    };
  }, [postRender, clearWatchdog]);

  useEffect(() => {
    if (readyRef.current) postRender();
  }, [jsx, data, postRender]);

  if (bootFailed) {
    return (
      <HudFallback message="HUD frame failed to load. Rebuild it with `npm run build:frame` and reload." />
    );
  }

  return (
    <iframe
      ref={iframeRef}
      className="hud-live-frame"
      data-testid="hud-live-frame"
      title="HUD frame"
      src={HUD_FRAME_URL}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{ height: `${height}px` }}
    />
  );
}

function HudFallback({ message }: { message: string }) {
  return (
    <div className="hud-live-fallback" data-testid="hud-fallback">
      <Panel title="HUD fallback" state="critical">
        <Alert
          severity="critical"
          title="HUD render failed"
          message={message}
        />
      </Panel>
    </div>
  );
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
