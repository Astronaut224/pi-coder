import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import {
  buildServerEnv,
  getFreePort,
  RestartTracker,
  waitForReady,
} from "./server-utils";

export interface ServerManagerOptions {
  /** "standalone":fork 打包的 server.js;"dev":连已运行的 next dev url。 */
  mode: "standalone" | "dev";
  /** dev 模式的目标 url,如 http://127.0.0.1:30141。 */
  devUrl?: string;
  /** standalone server.js 绝对路径;不传则按 app.isPackaged 推导。 */
  serverPath?: string;
  /** 超出重启上限时回调(用于通知用户)。 */
  onUnrecoverable?: () => void;
  /** 收到 server stdout/stderr 日志。 */
  onLog?: (line: string) => void;
}

export class ServerManager {
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private url: string | null = null;
  private restarts = new RestartTracker(3, 300000);
  private stopping = false;

  constructor(private readonly opts: ServerManagerOptions) {}

  private resolveServerPath(): string {
    if (this.opts.serverPath) return this.opts.serverPath;
    return app.isPackaged
      ? path.join(process.resourcesPath, "server", "server.js")
      : path.join(app.getAppPath(), ".next", "standalone", "server.js");
  }

  async start(): Promise<{ port: number; url: string }> {
    if (this.opts.mode === "dev") {
      const url = this.opts.devUrl ?? "http://127.0.0.1:30141";
      await waitForReadyUrl(url);
      this.url = url;
      return { port: new URL(url).port ? Number(new URL(url).port) : 80, url };
    }

    const port = await getFreePort();
    if (this.stopping) {
      throw new Error("server manager is stopping; aborting fork");
    }
    const serverPath = this.resolveServerPath();
    // The forked standalone server resolves all of its deps (next,
    // @earendil-works/*, undici, …) from its own real node_modules, shipped alongside
    // server.js via extraResources. No NODE_PATH is needed: CJS require() and the ESM
    // import() Next uses for serverExternalPackages both resolve through that dir.
    this.child = fork(serverPath, [], {
      env: buildServerEnv(port),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const log = (chunk: Buffer) => {
      const line = chunk.toString();
      this.opts.onLog?.(line);
      if (process.env.PI_WEB_DESKTOP_DEBUG) process.stdout.write(line);
    };
    this.child.stdout?.on("data", log);
    this.child.stderr?.on("data", log);
    this.child.on("exit", (code) => {
      this.opts.onLog?.(`[server] exited code=${code}\n`);
      this.child = null;
      if (this.stopping) return;
      if (this.restarts.canRestart()) {
        this.restarts.record();
        this.opts.onLog?.(`[server] restarting (attempt within limit)\n`);
        void this.restart();
      } else {
        this.opts.onUnrecoverable?.();
      }
    });

    await waitForReady(port, { timeoutMs: 30000 });
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    return { port, url: this.url };
  }

  private async restart(): Promise<void> {
    try {
      await this.start();
    } catch {
      // 停机过程中 start() 抛错是预期的,不触发不可恢复回调
      if (this.stopping) return;
      this.opts.onUnrecoverable?.();
    }
  }

  getUrl(): string | null {
    return this.url;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.child) {
      await new Promise<void>((resolve) => {
        const c = this.child!;
        c.once("exit", () => resolve());
        c.kill("SIGTERM");
        // 兜底:3s 后若子进程仍存活则强杀
        // (c.killed 仅表示已发送信号,不代表已退出;用 exitCode/signalCode 判断是否仍存活)
        setTimeout(() => {
          if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
          resolve();
        }, 3000).unref();
      });
      this.child = null;
    }
  }

  /**
   * 强杀 server 子进程并等待其真正退出(最长 timeoutMs),专用于"退出并安装更新"前
   * 确保 NSIS 安装器 spawn 时已无同名 Pi Coder.exe 残留。
   *
   * 与 killNow() 的区别:killNow() 发完 SIGKILL 立即返回,不等待进程被 OS 回收;
   * 本方法会 await 子进程的 exit 事件(或超时),从而在调用 quitAndInstall()
   * 之前让进程彻底消失。这修复了安装器 spawn 后仍检测到残留 Pi Coder.exe、
   * 反复弹出"无法关闭应用程序"对话框的 bug。
   */
  async killAndWait(timeoutMs = 5000): Promise<void> {
    this.stopping = true;
    const c = this.child;
    this.child = null;
    if (!c) return;
    // 进程已退出则无需等待
    if (c.exitCode !== null || c.signalCode !== null) return;
    try {
      c.kill("SIGKILL");
    } catch {
      /* 进程已退出 */
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      c.once("exit", finish);
      setTimeout(finish, timeoutMs).unref();
    });
  }

  /**
   * 同步、瞬时地强杀 server 子进程(发 SIGKILL 后立即返回,不等待 exit)。
   *
   * 专用于 before-quit-for-update 回调:作为 killAndWait() 之后的安全兜底,确保
   * 即便 onBeforeInstall 未执行(如 autoInstallOnAppQuit 路径)也不会遗留孤儿进程。
   * 普通退出仍走 stop() 的优雅关闭。
   */
  killNow(): void {
    this.stopping = true;
    const c = this.child;
    this.child = null;
    if (c) {
      try {
        c.kill("SIGKILL");
      } catch {
        /* 进程已退出 */
      }
    }
  }
}

function waitForReadyUrl(url: string): Promise<void> {
  const { port, hostname } = new URL(url);
  return waitForReady(Number(port) || 80, { host: hostname });
}
