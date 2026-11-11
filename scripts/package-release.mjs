import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function readArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const target = readArg("--target", process.platform === "win32" ? "win-x64" : "linux-x64");
if (!["win-x64", "linux-x64"].includes(target)) {
  console.error(`Destino inválido: ${target}. Use win-x64 ou linux-x64.`);
  process.exit(1);
}

const runtimeSrc = readArg("--runtime-dir", "");
const skipBuild = args.includes("--skip-build");
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = String(rootPkg.version || "1.0.0").replace(/^v/, "");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

if (!skipBuild) {
  execFileSync(npmCmd, ["run", "build"], { cwd: rootDir, stdio: "inherit" });
}

const releaseRoot = path.join(rootDir, "release");
const stageName = `twcin-v${version}-${target}`;
const stageDir = path.join(releaseRoot, stageName);
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

// 1. Copia backend compilado e instala apenas dependências de produção (sem devDependencies).
const stageBackend = path.join(stageDir, "backend");
fs.mkdirSync(stageBackend, { recursive: true });
fs.cpSync(path.join(rootDir, "backend", "dist"), path.join(stageBackend, "dist"), { recursive: true });
fs.copyFileSync(path.join(rootDir, "backend", "package.json"), path.join(stageBackend, "package.json"));
fs.copyFileSync(path.join(rootDir, "backend", "package-lock.json"), path.join(stageBackend, "package-lock.json"));
execFileSync(npmCmd, ["ci", "--omit=dev", "--ignore-scripts"], { cwd: stageBackend, stdio: "inherit" });
fs.rmSync(path.join(stageBackend, "package-lock.json"), { force: true });

// 2. Copia frontend compilado e metadados.
fs.cpSync(path.join(rootDir, "frontend", "dist"), path.join(stageDir, "public"), { recursive: true });
fs.copyFileSync(path.join(rootDir, "backend", ".env.example"), path.join(stageDir, "config.env.example"));
for (const docFile of ["README.md", "CHANGELOG.md", "LICENSE"]) {
  const src = path.join(rootDir, docFile);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stageDir, docFile));
}
if (fs.existsSync(path.join(rootDir, "docs", "DEPLOY.md"))) {
  fs.mkdirSync(path.join(stageDir, "docs"), { recursive: true });
  fs.copyFileSync(path.join(rootDir, "docs", "DEPLOY.md"), path.join(stageDir, "docs", "DEPLOY.md"));
}

// 3. Scripts específicos do sistema operacional.
const deploySubdir = target === "win-x64" ? "windows" : "linux";
const deploySrc = path.join(rootDir, "deploy", deploySubdir);
for (const entry of fs.readdirSync(deploySrc)) {
  const destFile = path.join(stageDir, entry);
  fs.copyFileSync(path.join(deploySrc, entry), destFile);
  if (entry.endsWith(".sh")) {
    fs.chmodSync(destFile, 0o755);
  }
}

// 4. Runtime portátil opcional (node.exe + WinSW no CI Windows; bin/node no Linux se fornecido).
if (runtimeSrc) {
  const absRuntime = path.resolve(rootDir, runtimeSrc);
  if (fs.existsSync(absRuntime)) {
    const destRuntime = path.join(stageDir, "runtime");
    fs.cpSync(absRuntime, destRuntime, { recursive: true });
    const linuxNode = path.join(destRuntime, "bin", "node");
    if (fs.existsSync(linuxNode)) fs.chmodSync(linuxNode, 0o755);
  }
}

// 5. Empacotamento final (.zip para Windows Server, .tar.gz para Linux).
if (target === "win-x64") {
  const zipPath = path.join(releaseRoot, `${stageName}.zip`);
  fs.rmSync(zipPath, { force: true });
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`],
      { stdio: "inherit" }
    );
  } else {
    const hasZip = spawnSync("zip", ["-v"], { stdio: "ignore" }).status === 0;
    if (hasZip) {
      execFileSync("zip", ["-qr", zipPath, stageName], { cwd: releaseRoot, stdio: "inherit" });
    } else {
      console.warn("Utilitário 'zip' não encontrado; diretório pronto em:", stageDir);
    }
  }
  console.log(`Pacote Windows gerado: ${zipPath}`);
} else {
  const tgzPath = path.join(releaseRoot, `${stageName}.tar.gz`);
  fs.rmSync(tgzPath, { force: true });
  execFileSync("tar", ["-czf", tgzPath, stageName], { cwd: releaseRoot, stdio: "inherit" });
  console.log(`Pacote Linux gerado: ${tgzPath}`);
}
