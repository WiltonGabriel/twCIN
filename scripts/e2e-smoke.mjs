import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(rootDir, "backend", "dist", "server.js");
const axeScriptPath = path.join(rootDir, "frontend", "node_modules", "axe-core", "axe.min.js");
if (!fs.existsSync(serverEntry)) {
  console.error("Execute `npm run build` antes de rodar o teste E2E.");
  process.exit(1);
}
if (!fs.existsSync(axeScriptPath)) {
  console.error("Execute `npm --prefix frontend install` para disponibilizar axe-core antes do E2E.");
  process.exit(1);
}
const axeSource = fs.readFileSync(axeScriptPath, "utf8");

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

const chromeBin = findChromeBinary();
if (!chromeBin) {
  console.error("Chrome/Chromium/Edge não encontrado. Defina CHROME_BIN ou instale um navegador para rodar E2E.");
  process.exit(1);
}

class CdpClient {
  #ws;
  #id = 0;
  #pending = new Map();
  errors = [];

  constructor(wsUrl) {
    this.#ws = new WebSocket(wsUrl);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.#ws.addEventListener("open", () => resolve(), { once: true });
      this.#ws.addEventListener("error", (err) => reject(err), { once: true });
    });
    this.#ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.#pending.has(msg.id)) {
        const { resolve, reject } = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.errors.push(msg.params?.exceptionDetails?.text || "Runtime exception");
      }
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "JS eval error");
    }
    return res.result?.value;
  }

  async waitFor(fnExpr, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.eval(`Boolean(${fnExpr})`);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 120));
    }
    throw new Error(`Timeout aguardando: ${fnExpr}`);
  }

  close() {
    this.#ws.close();
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twcin-e2e-"));
const chromeProfile = path.join(tmpDir, "chrome-profile");
fs.mkdirSync(chromeProfile, { recursive: true });
const port = 3489;
const baseUrl = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, [serverEntry], {
  cwd: path.join(rootDir, "backend"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    DATA_DIR: tmpDir,
    SERVE_FRONTEND: "true",
    CORS_ORIGIN: baseUrl,
    AUTO_BACKUP_HOURS: "0",
    LOG_LEVEL: "error"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let chrome = null;
let cdp = null;

try {
  // 1. Aguarda backend responder /api/health com SQLite ativo
  let healthy = false;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.status, "ok");
        assert.ok(typeof body.version === "string" && body.version.length > 0);
        healthy = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  assert.ok(healthy, "Servidor de produção não respondeu em /api/health");

  // 2. Inicia Chrome headless real para validar PWA/bundle/setup/fluxos no navegador
  chrome = spawn(
    chromeBin,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--mute-audio",
      "--window-size=1280,900",
      "--remote-debugging-port=0",
      `--user-data-dir=${chromeProfile}`,
      "about:blank"
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  let chromeStderr = "";
  const debugPort = await new Promise((resolve, reject) => {
    const activePortFile = path.join(chromeProfile, "DevToolsActivePort");
    let settled = false;
    const finish = (portNum) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(portNum);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error(`Chrome não abriu porta DevTools em 30s. stderr: ${chromeStderr.slice(-600)}`));
    }, 30000);

    chrome.stderr?.on("data", (chunk) => {
      chromeStderr += String(chunk);
      const match = chromeStderr.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (match && Number(match[1]) > 0) {
        finish(Number(match[1]));
      }
    });

    chrome.once("exit", (code, signal) => {
      fail(new Error(`Chrome encerrou antes do DevTools abrir (code=${code}, signal=${signal}). stderr: ${chromeStderr.slice(-600)}`));
    });

    const poll = setInterval(() => {
      if (fs.existsSync(activePortFile)) {
        try {
          const firstLine = fs.readFileSync(activePortFile, "utf8").split(/\r?\n/)[0]?.trim();
          if (firstLine && Number(firstLine) > 0) {
            finish(Number(firstLine));
          }
        } catch {
          // No Windows o Chrome pode manter o arquivo brevemente bloqueado (EBUSY) ao gravar.
        }
      }
    }, 80);
  });

  const targetsRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await targetsRes.json();
  const pageTarget = targets.find((t) => t.type === "page") ?? targets[0];
  assert.ok(pageTarget?.webSocketDebuggerUrl, "Alvo de página DevTools não encontrado");

  cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.navigate", { url: baseUrl });

  const runAxeAudit = async (screenLabel) => {
    await cdp.waitFor(`(() => {
      const page = document.querySelector('main > div');
      return !page || getComputedStyle(page).opacity === '1';
    })()`);
    const injected = await cdp.eval(`Boolean(window.axe)`);
    if (!injected) {
      await cdp.eval(axeSource);
    }
    const result = await cdp.eval(`window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
    })`);
    const blocking = (result.violations || []).filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );
    if (blocking.length > 0) {
      const details = blocking
        .map(
          (v) =>
            `[${v.impact}] ${v.id}: ${v.help} (${v.nodes
              .slice(0, 3)
              .map((n) => n.target.join(" "))
              .join(", ")})`
        )
        .join("\n  ");
      throw new Error(`Violações de acessibilidade (axe-core) em ${screenLabel}:\n  ${details}`);
    }
    const other = (result.violations || []).filter(
      (v) => v.impact !== "critical" && v.impact !== "serious"
    );
    console.log(`a11y [${screenLabel}]: 0 críticas/sérias (outras: ${other.length})`);
  };

  // 3. Setup inicial pela interface real no navegador + auditoria axe-core
  await cdp.waitFor(`document.querySelector('input[autocomplete="name"]')`);
  await runAxeAudit("Setup Inicial");
  await cdp.eval(`(() => {
    const setVal = (el, val) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setVal(document.querySelector('input[autocomplete="name"]'), 'Admin E2E');
    setVal(document.querySelector('input[autocomplete="username"]'), 'admine2e');
    setVal(document.querySelector('input[autocomplete="new-password"]'), 'SenhaE2E2026');
  })()`);
  await new Promise((r) => setTimeout(r, 80));
  await cdp.eval(`document.querySelector('form button[type="submit"]').click()`);

  // 4. Valida carregamento do AppShell após login + navegação e axe-core nas principais telas
  await cdp.waitFor(`document.body.innerText.includes('Admin E2E') && document.body.innerText.includes('Por Setor')`);
  await runAxeAudit("Início");

  await cdp.eval(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('Equipamentos')).click()`);
  await cdp.waitFor(`document.body.innerText.includes('Devolvidos ao dono')`);
  await runAxeAudit("Equipamentos");

  await cdp.eval(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('Movimentações')).click()`);
  await cdp.waitFor(`document.body.innerText.includes('Nova movimentação')`);
  await runAxeAudit("Movimentações");

  await cdp.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Nova movimentação')).click()`);
  await cdp.waitFor(`document.querySelector('dialog[open]')`);
  await new Promise((r) => setTimeout(r, 250));
  await runAxeAudit("Modal Nova Movimentação");
  await cdp.eval(`document.querySelector('dialog[open] button[aria-label="Fechar"]').click()`);
  await cdp.waitFor(`!document.querySelector('dialog[open]')`);

  await cdp.eval(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('Por Setor')).click()`);
  await cdp.waitFor(`document.body.innerText.includes('Por Setor (Dossiê)')`);
  await runAxeAudit("Por Setor");

  await cdp.eval(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('Configurações')).click()`);
  await cdp.waitFor(`document.body.innerText.includes('Cadastros') && document.body.innerText.includes('Aparência')`);
  await runAxeAudit("Configurações");

  assert.equal(cdp.errors.length, 0, `Erros JS inesperados no navegador: ${cdp.errors.join("; ")}`);

  // 5. Testa encerramento gracioso do servidor via SIGTERM (SQLite WAL fecha sem erro)
  server.kill("SIGTERM");
  const exitResult = await new Promise((resolve) => {
    server.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (process.platform === "win32") {
    assert.ok(
      exitResult.code === 0 || exitResult.signal === "SIGTERM",
      `Encerramento inesperado no Windows: code=${exitResult.code}, signal=${exitResult.signal}`
    );
  } else {
    assert.equal(exitResult.code, 0, "Servidor deve encerrar com código 0 no SIGTERM");
  }
  assert.ok(fs.existsSync(path.join(tmpDir, "twcin.db")), "Banco SQLite deve existir em DATA_DIR");

  console.log("E2E Browser + Produção (SERVE_FRONTEND=true + SIGTERM): OK");
} finally {
  try { cdp?.close(); } catch {}
  try { chrome?.kill("SIGKILL"); } catch {}
  try { if (server.exitCode === null) server.kill("SIGKILL"); } catch {}
  await new Promise((r) => setTimeout(r, 250));
  try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
