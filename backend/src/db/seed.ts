import type { DatabaseSync } from "node:sqlite";
import type { EnvConfig } from "../config/env.js";
import { hashPassword } from "../security/password.js";
import { withTransaction } from "./connection.js";

export function seedInitialData(db: DatabaseSync, env: EnvConfig): void {
  const now = new Date().toISOString();

  withTransaction(db, () => {
    const insertSetting = db.prepare(`
      INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    `);
    insertSetting.run("app_name", "twCIN", now);
    insertSetting.run("org_name", "Setor de TI", now);
    insertSetting.run("logo_data_url", "", now);
    insertSetting.run("loan_default_days", "7", now);

    if (env.seedAdminUsername && env.seedAdminPassword) {
      const userCountRow = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
      if (userCountRow.count === 0) {
        db.prepare(`
          INSERT INTO users (
            full_name, username, password_hash, active, must_change_password, token_version, created_at, updated_at
          ) VALUES (?, ?, ?, 1, 1, 1, ?, ?)
        `).run(
          env.seedAdminName || env.seedAdminUsername,
          env.seedAdminUsername.toLowerCase(),
          hashPassword(env.seedAdminPassword),
          now,
          now
        );
      }
    }
  });
}
