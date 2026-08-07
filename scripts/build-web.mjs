// scripts/build-web.mjs
// Build pi-web (Next standalone), redirecting USERPROFILE to an empty dir to
// work around Next's @vercel/nft tracer globbing the user home (EPERM on
// protected Windows junctions). On macOS/Linux, os.homedir() reads HOME not
// USERPROFILE, so setting USERPROFILE is a harmless no-op there.
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const fakehome = path.join(process.cwd(), ".superpowers", "sdd", "fakehome");
mkdirSync(fakehome, { recursive: true });

const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build", "--webpack"],
  { env: { ...process.env, USERPROFILE: fakehome }, stdio: "inherit" },
);

process.exit(result.status ?? 1);
