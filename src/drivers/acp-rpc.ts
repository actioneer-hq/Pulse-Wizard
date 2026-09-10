import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** A bidirectional JSON-message channel. Abstracted so the peer can run over a subprocess's stdio in
 * production and over an in-memory double in tests. */
export interface RpcConnection {
  send(msg: unknown): void;
  onMessage(cb: (msg: Record<string, unknown>) => void): void;
  close(): void;
}

type Handler = (params: Record<string, unknown>) => Promise<unknown> | unknown;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Minimal JSON-RPC 2.0 peer: issue requests (matched by id), serve incoming requests via registered
 * method handlers, and route notifications. */
export class RpcPeer {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Handler>();

  constructor(private readonly conn: RpcConnection) {
    conn.onMessage((msg) => this.dispatch(msg));
  }

  on(method: string, handler: Handler): void {
    this.handlers.set(method, handler);
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.conn.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private async dispatch(msg: Record<string, unknown>): Promise<void> {
    const hasId = msg.id !== undefined && msg.id !== null;
    const method = msg.method as string | undefined;

    if (hasId && !method) {
      // a response to one of our requests
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }

    if (method) {
      const handler = this.handlers.get(method);
      const params = (msg.params ?? {}) as Record<string, unknown>;
      if (hasId) {
        // an incoming request — must respond
        try {
          const result = handler ? await handler(params) : null;
          this.conn.send({ jsonrpc: "2.0", id: msg.id, result: result ?? null });
        } catch (e) {
          this.conn.send({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32000, message: (e as Error).message },
          });
        }
      } else if (handler) {
        // a notification — no response
        await handler(params);
      }
    }
  }
}

/** Newline-delimited JSON framing over a child process's stdio.
 * NOTE: confirm ACP framing (ndjson vs Content-Length headers) against a real agent — swap this impl
 * if it turns out to be header-framed. */
export class StdioConnection implements RpcConnection {
  private buf = "";
  private cb: ((msg: Record<string, unknown>) => void) | null = null;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buf += chunk;
      let nl = this.buf.indexOf("\n");
      while (nl >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (line) {
          try {
            this.cb?.(JSON.parse(line));
          } catch {
            // non-JSON stdout line (banner/log) — ignore
          }
        }
        nl = this.buf.indexOf("\n");
      }
    });
  }

  send(msg: unknown): void {
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  onMessage(cb: (msg: Record<string, unknown>) => void): void {
    this.cb = cb;
  }

  close(): void {
    this.child.stdin.end();
  }
}
