import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import http from "node:http";

async function loadSubject() {
  return import("./server-utils.ts");
}

test("buildServerEnv sets PORT, HOSTNAME, ELECTRON_RUN_AS_NODE", async () => {
  const { buildServerEnv } = await loadSubject();
  const env = buildServerEnv(31415);
  assert.equal(env.PORT, "31415");
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
});

test("buildServerEnv preserves process.env and lets extra override", async () => {
  const { buildServerEnv } = await loadSubject();
  process.env.FOO_MARKER = "kept";
  const env = buildServerEnv(1, { FOO_MARKER: "overridden", CUSTOM: "x" });
  assert.equal(env.FOO_MARKER, "overridden");
  assert.equal(env.CUSTOM, "x");
  delete process.env.FOO_MARKER;
});

test("getFreePort returns a free, bindable port", async () => {
  const { getFreePort } = await loadSubject();
  const port = await getFreePort();
  assert.equal(typeof port, "number");
  assert.ok(port > 0);
  // 拿到的端口应能被监听
  await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve()));
  });
});

test("waitForReady resolves when server responds <500", async () => {
  const { getFreePort, waitForReady } = await loadSubject();
  const port = await getFreePort();
  const srv = http.createServer((_req, res) => res.statusCode = 200 && res.end("ok"));
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  await waitForReady(port, { timeoutMs: 3000, intervalMs: 100 });
  srv.close();
});

test("waitForReady rejects on timeout when nothing listens", async () => {
  const { getFreePort, waitForReady } = await loadSubject();
  const port = await getFreePort(); // 空闲端口,无人监听
  await assert.rejects(
    waitForReady(port, { timeoutMs: 400, intervalMs: 100 }),
    /not ready|timeout|ECONNREFUSED/i,
  );
});

test("RestartTracker allows restarts up to max within window", async () => {
  const { RestartTracker } = await loadSubject();
  const t = new RestartTracker(3, 60000);
  assert.equal(t.canRestart(), true);
  t.record();
  t.record();
  t.record();
  assert.equal(t.canRestart(), false); // 已达 3 次
});

test("RestartTracker resets after the window elapses", async () => {
  const { RestartTracker } = await loadSubject();
  const t = new RestartTracker(1, 50); // 50ms 窗口
  t.record();
  assert.equal(t.canRestart(), false);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(t.canRestart(), true);
});
