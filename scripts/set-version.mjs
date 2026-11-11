import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextVersion = process.argv[2]?.replace(/^v/, "").trim();

if (!nextVersion || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error("Uso: node scripts/set-version.mjs <versao> (ex.: 1.0.0)");
  process.exit(1);
}

for (const rel of ["package.json", "backend/package.json", "frontend/package.json"]) {
  const fullPath = path.join(rootDir, rel);
  const pkg = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  pkg.version = nextVersion;
  fs.writeFileSync(fullPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(`Atualizado ${rel} -> ${nextVersion}`);
}

for (const lockRel of ["backend/package-lock.json", "frontend/package-lock.json"]) {
  const lockPath = path.join(rootDir, lockRel);
  if (!fs.existsSync(lockPath)) continue;
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.version = nextVersion;
  if (lock.packages?.[""]) {
    lock.packages[""].version = nextVersion;
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  console.log(`Atualizado ${lockRel} -> ${nextVersion}`);
}
