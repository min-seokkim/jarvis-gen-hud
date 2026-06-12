import { useContext, useEffect, useState } from 'react';
import { LiveContext, LivePreview, LiveProvider } from 'react-live';
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
} from '../hud';
import {
  isHudFrameRenderMessage,
  type HudFrameRenderMessage,
} from '../lib/hudFrameProtocol';
import { post } from './post';

const COMPONENT_SCOPE = {
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
};

export function FrameApp() {
  const [payload, setPayload] = useState<HudFrameRenderMessage | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const message: unknown = event.data;
      if (isHudFrameRenderMessage(message)) setPayload(message);
    }

    window.addEventListener('message', onMessage);
    post({ type: 'hud:ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      post({
        type: 'hud:size',
        height: document.documentElement.scrollHeight,
      });
    });
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  if (!payload) return null;

  return (
    <LiveProvider
      code={payload.jsx}
      scope={{ ...COMPONENT_SCOPE, data: payload.data }}
      language="tsx"
    >
      <StatusBridge payload={payload} />
      <LivePreview className="hud-frame-preview" />
    </LiveProvider>
  );
}

function StatusBridge({ payload }: { payload: HudFrameRenderMessage }) {
  const live = useContext(LiveContext);

  useEffect(() => {
    if (live.error) post({ type: 'hud:error', message: live.error });
    else post({ type: 'hud:rendered' });
  }, [live.error, payload]);

  return null;
}
