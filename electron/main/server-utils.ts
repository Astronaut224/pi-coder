import net from "node:net";
import http from "node:http";

/** 组合 Next standalone 子进程所需的环境变量。 */
export function buildServerEnv(
  port: number,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    ...extra,
  };
}

/** 在 127.0.0.1 上获取一个当前空闲的端口。 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("failed to obtain a free port"));
      }
    });
  });
}

export interface WaitForReadyOptions {
  host?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

/** 轮询 http://host:port/ 直到返回 <500,或超时。 */
export function waitForReady(
  port: number,
  opts: WaitForReadyOptions = {},
): Promise<void> {
  const host = opts.host ?? "127.0.0.1";
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 300;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(
        { host, port, path: "/", timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            cleanup();
            resolve();
          } else {
            scheduleNext();
          }
        },
      );
      req.on("error", scheduleNext);
      req.on("timeout", () => {
        req.destroy();
        scheduleNext();
      });
    };

    const interval = setInterval(probe, intervalMs);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`server on ${host}:${port} not ready within ${timeoutMs}ms`));
    }, timeoutMs);

    function scheduleNext() { /* setInterval 会继续;只防提前 resolve */ }
    function cleanup() {
      clearInterval(interval);
      clearTimeout(timer);
    }

    probe(); // 立即先探一次
  });
}

/** 在时间窗口内限制子进程重启次数。 */
export class RestartTracker {
  private timestamps: number[] = [];
  private readonly maxRestarts: number;
  private readonly windowMs: number;
  constructor(maxRestarts: number = 3, windowMs: number = 300000) {
    this.maxRestarts = maxRestarts;
    this.windowMs = windowMs;
  }

  /** 记录一次重启(清理窗口外的旧记录)。 */
  record(): void {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    this.timestamps.push(now);
  }

  /** 是否仍可重启(窗口内次数 < max)。 */
  canRestart(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length < this.maxRestarts;
  }
}
