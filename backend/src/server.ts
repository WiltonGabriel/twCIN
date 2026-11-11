import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { listenWithPortPolicy } from "./config/listen.js";
import { startScheduledBackups } from "./services/backup.service.js";

async function main() {
  const env = loadEnv();
  const { app, db } = await buildApp({
    env,
    logger: { level: env.logLevel || "info" },
    disableRequestLogging: process.env.LOG_REQUESTS !== "true"
  });

  const stopBackups =
    env.autoBackupHours && env.autoBackupHours > 0 && env.backupDir
      ? startScheduledBackups(
          db,
          {
            backupDir: env.backupDir,
            intervalHours: env.autoBackupHours,
            retainCount: env.autoBackupRetain ?? 14
          },
          (level, msg) => {
            if (level === "error") app.log.error(msg);
            else app.log.info(msg);
          }
        )
      : null;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`[twCIN] Sinal ${signal} recebido. Encerrando com segurança...`);
    stopBackups?.();

    const forceTimer = setTimeout(() => {
      app.log.error("[twCIN] Tempo esgotado no encerramento gracioso; saindo.");
      process.exit(1);
    }, 8000);
    forceTimer.unref();

    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "[twCIN] Erro ao encerrar servidor");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    app.log.error({ err: reason }, "[twCIN] Promise rejeitada não tratada");
  });
  process.on("uncaughtException", (err) => {
    app.log.fatal({ err }, "[twCIN] Exceção não capturada");
    void shutdown("uncaughtException");
  });

  try {
    const bound = await listenWithPortPolicy(app, {
      port: env.port,
      host: env.host,
      autoFallback: env.portAutoFallback,
      envFilePath: env.envFilePath
    });
    if (bound.fallbackFrom !== null) {
      console.warn(
        `[twCIN] AVISO: Porta ${bound.fallbackFrom} já estava em uso; usando temporariamente a porta ${bound.port}.`
      );
    }
    const displayHost = env.host === "0.0.0.0" ? "localhost" : env.host;
    console.log(`twCIN v${env.appVersion || "1.0.0"} rodando em http://${displayHost}:${bound.port}`);
  } catch (err) {
    stopBackups?.();
    await app.close().catch(() => {});
    throw err;
  }
}

main().catch((err) => {
  console.error("Falha ao iniciar servidor:", err instanceof Error ? err.message : err);
  process.exit(1);
});
