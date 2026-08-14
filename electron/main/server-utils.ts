import net from "node:net";
import http from "node:http";

/**
 * 固定首选端口。standalone 模式优先绑定它,使 Electron 加载的 origin
 * (http://127.0.0.1:<port>) 在每次启动时保持不变。localStorage 按 origin
 * 隔离,端口随机变会导致主题/深浅色/会话置顶/完成状态等全部丢失。
 * 端口被占时回退到任意空闲端口,不影响启动成功率(仅该次无法持久化)。
 */
export const PREFERRED_PORT = 30141;

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

/**
 * 在 127.0.0.1 上获取一个空闲端口。传入 preferred 时优先尝试该端口,
 * 若被占用则回退到任意空闲端口(端口 0 由 OS 分配)——保证固定端口
 * (从而 renderer 的 localStorage origin 稳定)的同时不影响启动成功率。
 */
export function getFreePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number | undefined, isFallback: boolean) => {
      const srv = net.createServer();
      srv.on("error", () => {
        if (isFallback) {
          reject(new Error("failed to obtain a free port"));
          return;
        }
        // 首选端口被占用,回退到任意空闲端口
        attempt(undefined, true);
      });
      srv.listen(port ?? 0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          const bound = addr.port;
          srv.close(() => resolve(bound));
        } else {
          reject(new Error("failed to obtain a free port"));
        }
      });
    };
    attempt(preferred, false);
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
