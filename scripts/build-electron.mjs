import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");
const targetDir = path.join(root, "resources", "server");

async function main() {
  await stat(standaloneDir).catch(() => {
    throw new Error(".next/standalone not found — run `npm run build:web` first");
  });

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  // 1) standalone body: server.js + node_modules (incl. proper-lockfile bundled NESTED
  //    under pi-coding-agent/node_modules — recursive cp copies it correctly).
  await cp(standaloneDir, targetDir, { recursive: true });

  // electron-builder's file filter excludes the *top-level* "node_modules" dir from
  // extraResources (app-builder-lib util/filter.js: `relative === "node_modules"`),
  // which would strip the server's deps from the package and make the forked server
  // fail with `Cannot find module 'next'`. Rename it to a non-reserved dir; nested
  // node_modules (version-pinned deps under next/, sharp/, @earendil-works/*/) are
  // NOT excluded, so they survive. The forked process resolves top-level deps from
  // here via NODE_PATH (set in server-manager.ts at fork time).
  await rename(path.join(targetDir, "node_modules"), path.join(targetDir, "modules"));

  // 2) .next/static + public are NOT in standalone by default — copy them in.
  await cp(path.join(root, ".next", "static"), path.join(targetDir, ".next", "static"), { recursive: true });
  await cp(path.join(root, "public"), path.join(targetDir, "public"), { recursive: true });

  console.log("[build-electron] assembled server at", targetDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
