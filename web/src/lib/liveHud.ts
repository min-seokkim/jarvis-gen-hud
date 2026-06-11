import type { HudData } from './hudData';

export const LIVE_HUD_SOURCES = [
  'disk',
  'project',
  'build_sim',
  'proc_watch',
] as const;

export type LiveHudSource = (typeof LIVE_HUD_SOURCES)[number];

export interface LiveHudSpec {
  source: LiveHudSource;
  params?: Record<string, unknown>;
  intervalMs?: number;
}

export interface LiveHudDataMessage {
  type: 'hud.data';
  subId: string;
  data: HudData;
}

export interface LiveHudEndMessage {
  type: 'hud.end';
  subId: string;
  reason?: string;
}

export interface LiveHudErrorMessage {
  type: 'error';
  message: string;
}

export type LiveHudServerMessage =
  | LiveHudDataMessage
  | LiveHudEndMessage
  | LiveHudErrorMessage;

interface LiveHudSubscription {
  subId: string;
  source: LiveHudSource;
  params?: Record<string, unknown>;
  intervalMs: number;
}

export interface LiveHudClientOptions {
  url?: string;
  WebSocketCtor?: typeof WebSocket;
  onData: (message: LiveHudDataMessage) => void;
  onEnd: (message: LiveHudEndMessage) => void;
  onError?: (message: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}

const MIN_INTERVAL_MS = 1000;

export class LiveHudClient {
  private readonly url: string;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly options: LiveHudClientOptions;
  private readonly subscriptions = new Map<string, LiveHudSubscription>();
  private socket: WebSocket | null = null;
  private reconnectTimer: number | undefined;
  private reconnectDelayMs = 500;
  private closed = false;

  constructor(options: LiveHudClientOptions) {
    this.options = options;
    this.url = options.url ?? defaultLiveHudUrl();
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket;
  }

  subscribe(spec: LiveHudSpec): string {
    const subId = `hud-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.subscriptions.set(subId, {
      subId,
      source: spec.source,
      params: spec.params,
      intervalMs: Math.max(spec.intervalMs ?? 2000, MIN_INTERVAL_MS),
    });
    this.ensureSocket();
    this.sendSubscribe(this.subscriptions.get(subId)!);
    return subId;
  }

  unsubscribe(subId: string): void {
    this.subscriptions.delete(subId);
    this.send({ type: 'hud.unsubscribe', subId });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.socket = null;
  }

  private ensureSocket(): void {
    if (this.closed) return;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.socket = new this.WebSocketCtor(this.url);
    this.socket.addEventListener('open', () => {
      this.reconnectDelayMs = 500;
      this.options.onConnectionChange?.(true);
      for (const subscription of this.subscriptions.values()) {
        this.sendSubscribe(subscription);
      }
    });
    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });
    this.socket.addEventListener('close', () => {
      this.options.onConnectionChange?.(false);
      this.scheduleReconnect();
    });
    this.socket.addEventListener('error', () => {
      this.options.onConnectionChange?.(false);
      this.options.onError?.('live_hud_socket_error');
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.subscriptions.size === 0) return;
    if (this.reconnectTimer !== undefined) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 8000);
      this.ensureSocket();
    }, this.reconnectDelayMs);
  }

  private sendSubscribe(subscription: LiveHudSubscription): void {
    this.send({
      type: 'hud.subscribe',
      subId: subscription.subId,
      source: subscription.source,
      params: subscription.params ?? {},
      intervalMs: subscription.intervalMs,
    });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: LiveHudServerMessage;
    try {
      parsed = JSON.parse(raw) as LiveHudServerMessage;
    } catch {
      this.options.onError?.('invalid_live_hud_message');
      return;
    }

    if (parsed.type === 'hud.data') {
      this.options.onData(parsed);
    } else if (parsed.type === 'hud.end') {
      this.options.onEnd(parsed);
      this.subscriptions.delete(parsed.subId);
    } else if (parsed.type === 'error') {
      this.options.onError?.(parsed.message);
    }
  }
}

export function normalizeLiveHudSpec(value: unknown): LiveHudSpec | null {
  if (!isRecord(value)) return null;
  if (!isLiveHudSource(value.source)) return null;
  const intervalMs =
    typeof value.intervalMs === 'number' && Number.isFinite(value.intervalMs)
      ? Math.max(value.intervalMs, MIN_INTERVAL_MS)
      : undefined;
  return {
    source: value.source,
    params: isRecord(value.params) ? value.params : undefined,
    intervalMs,
  };
}

export function isLiveHudSource(value: unknown): value is LiveHudSource {
  return (
    typeof value === 'string' &&
    LIVE_HUD_SOURCES.includes(value as LiveHudSource)
  );
}

function defaultLiveHudUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
