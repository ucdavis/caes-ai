import "dotenv/config";

import { startTelemetry } from "./telemetry.js";

const telemetry = await startTelemetry();
const [
  { buildApp },
  { PostgresApplicationRegistry },
  { loadConfig },
  { closeDatabase, createDatabase, migrateDatabase },
  { PostgresSessionRepository },
  { PostgresOperationalStore },
  { FileCallbackTokenIssuer },
] = await Promise.all([
  import("./app.js"),
  import("./applications/registry.js"),
  import("./config.js"),
  import("./database/client.js"),
  import("./persistence/session-repository.js"),
  import("./persistence/operational-store.js"),
  import("./security/callback-tokens.js"),
]);

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
try {
  await migrateDatabase(database);
} catch (error) {
  await closeDatabase(database);
  await telemetry.shutdown();
  throw error;
}
const app = buildApp({
  config,
  applicationRegistry: new PostgresApplicationRegistry(database),
  sessionRepository: new PostgresSessionRepository(database),
  operationalStore: new PostgresOperationalStore(database),
  callbackTokens: await FileCallbackTokenIssuer.load(
    config.callbackIssuer,
    config.callbackTokenTtlMs,
    config.callbackSigningKeysPath || ".data/callback-signing-keys.json",
  ),
});
app.addHook("onClose", async () => closeDatabase(database));

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  try {
    await app.close();
  } finally {
    try {
      await telemetry.shutdown();
    } finally {
      process.exitCode = 0;
    }
  }
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  await app.close();
  await telemetry.shutdown();
  throw error;
}
