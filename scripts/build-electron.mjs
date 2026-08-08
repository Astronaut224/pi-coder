import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  //
  //    Keep the directory named "node_modules" (do NOT rename it). Next.js loads the
  //    externalized @earendil-works/* packages (next.config.ts serverExternalPackages)
  //    via ESM `import()`, which IGNORES NODE_PATH and resolves only by walking up a
  //    real "node_modules" directory from the importing route file. An earlier build
  //    renamed this to "modules" + set NODE_PATH; that worked for CJS require() but
  //    left every route that import()s those packages failing with
  //    ERR_MODULE_NOT_FOUND → HTTP 500 (e.g. /api/sessions, which also feeds the
  //    recent-projects list). electron-builder's top-level node_modules exclusion is
  //    handled instead in electron-builder.yml by shipping the deps to a nested
  //    destination (server/node_modules).
  await cp(standaloneDir, targetDir, { recursive: true });

  // 1b) Restore runtime data files Next.js standalone (nft) dropped. nft traces
  //     statically-imported modules but misses JSON the externalized
  //     @earendil-works/* packages read at runtime via fs.readFile — notably
  //     pi-coding-agent's dist/modes/interactive/theme/*.json loaded by initTheme.
  //     Without them the first operation that starts/restores a session
  //     (startRpcSession) throws ENOENT → HTTP 500, so e.g. switching models on an
  //     existing session silently fails (the request throws, the client never
  //     applies the override) while a brand-new session works (model selection is
  //     pure client state until the first send). Merge each package's full dist
  //     from the project node_modules to bring those files back.
  const externalizedPackages = ["pi-coding-agent", "pi-agent-core", "pi-ai", "pi-tui"];
  for (const pkg of externalizedPackages) {
    const srcDist = path.join(root, "node_modules", "@earendil-works", pkg, "dist");
    const dstPkgDir = path.join(targetDir, "node_modules", "@earendil-works", pkg);
    if (existsSync(srcDist) && existsSync(dstPkgDir)) {
      await cp(srcDist, path.join(dstPkgDir, "dist"), { recursive: true });
    }
  }

  // 2) .next/static + public are NOT in standalone by default — copy them in.
  await cp(path.join(root, ".next", "static"), path.join(targetDir, ".next", "static"), { recursive: true });
  await cp(path.join(root, "public"), path.join(targetDir, "public"), { recursive: true });

  console.log("[build-electron] assembled server at", targetDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
