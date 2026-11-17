import { useEffect, useRef, useState } from 'react';
import { fullJitter, describeDelay } from './backoff';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface ReconnectingSocketOptions {
  url: string;
  onMessage: (payload: unknown) => void;
  onStatus?: (status: SocketStatus, detail: string) => void;
  onOpen?: () => void;
  /** Optional application-level keepalive (the server also sends WS pings). */
  ping?: { intervalMs: number; payload: unknown };
}

/**
 * WebSocket with the same reconnect policy as the SSE stream. Every attempt is
 * jittered, so an instance restart does not collect 6,400 sockets in one tick.
 */
export class ReconnectingSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private manualClose = false;

  constructor(private readonly options: ReconnectingSocketOptions) {}

  connect(): void {
    this.manualClose = false;
    if (
      this.socket
      && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.options.onStatus?.('connecting', 'opening socket');

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.url);
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : 'invalid URL');
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.options.onStatus?.('open', 'socket open');
      this.options.onOpen?.();
      if (this.options.ping && this.options.ping.intervalMs > 0) {
        const ping = this.options.ping;
        this.stopPing();
        this.pingTimer = window.setInterval(() => this.send(ping.payload), ping.intervalMs);
      }
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        this.options.onMessage(JSON.parse(event.data) as unknown);
      } catch {
        // A malformed frame must never kill the console.
      }
    };

    socket.onerror = () => {
      // The close event that follows carries the reason; nothing to do here.
    };

    socket.onclose = (event: CloseEvent) => {
      this.stopPing();
      this.socket = null;
      if (this.manualClose) {
        this.options.onStatus?.('closed', 'closed by client');
        return;
      }
      const reason = event.reason || `socket closed (code ${event.code})`;
      this.scheduleReconnect(reason);
    };
  }

  private scheduleReconnect(reason: string): void {
    if (this.manualClose || this.reconnectTimer !== null) return;
    this.attempt = Math.min(this.attempt + 1, 10);
    const delay = fullJitter(this.attempt - 1);
    this.options.onStatus?.(
      'closed',
      `${reason}; retrying in ${describeDelay(delay)} (attempt ${this.attempt})`,
    );
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(payload: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  close(): void {
    this.manualClose = true;
    this.stopPing();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(1000, 'client_closed');
    this.socket = null;
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

export interface SocketHandle {
  status: SocketStatus;
  detail: string;
  send: (payload: unknown) => boolean;
}

/**
 * React wrapper. Handlers are kept in refs so that re-renders never recreate
 * the socket; only a different URL (different juror or auditor) reconnects.
 */
export const useReconnectingSocket = (
  url: string,
  onMessage: (payload: unknown) => void,
  options: { pingMs?: number; onOpen?: () => void } = {},
): SocketHandle => {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [detail, setDetail] = useState('opening socket');
  const socketRef = useRef<ReconnectingSocket | null>(null);

  const messageRef = useRef(onMessage);
  messageRef.current = onMessage;
  const openRef = useRef(options.onOpen);
  openRef.current = options.onOpen;

  const pingMs = options.pingMs ?? 0;

  useEffect(() => {
    const client = new ReconnectingSocket({
      url,
      onMessage: (payload) => messageRef.current(payload),
      onStatus: (next, nextDetail) => {
        setStatus(next);
        setDetail(nextDetail);
      },
      onOpen: () => openRef.current?.(),
      ping: pingMs > 0 ? { intervalMs: pingMs, payload: { type: 'ping' } } : undefined,
    });

    socketRef.current = client;
    client.connect();

    return () => {
      client.close();
      socketRef.current = null;
    };
  }, [url, pingMs]);

  return {
    status,
    detail,
    send: (payload: unknown) => socketRef.current?.send(payload) ?? false,
  };
};
