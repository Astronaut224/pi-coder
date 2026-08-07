import { cp, mkdir, rm, stat } from "node:fs/promises";
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

  // 2) .next/static + public are NOT in standalone by default — copy them in.
  await cp(path.join(root, ".next", "static"), path.join(targetDir, ".next", "static"), { recursive: true });
  await cp(path.join(root, "public"), path.join(targetDir, "public"), { recursive: true });

  console.log("[build-electron] assembled server at", targetDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
