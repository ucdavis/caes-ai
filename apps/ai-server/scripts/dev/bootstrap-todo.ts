import "dotenv/config";

import { requiredEnvironment } from "../../src/config.js";
import {
  closeDatabase,
  createDatabase,
  migrateDatabase,
} from "../../src/database/client.js";
import { bootstrapApplication } from "./application-bootstrap.js";

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

const database = createDatabase(requiredEnvironment("DATABASE_URL"));
try {
  await migrateDatabase(database);
  const result = await bootstrapApplication(database, {
    id: "todo-app",
    displayName: "CAES AI Todo",
    toolCallbackUrl: requiredEnvironment("CAES_AI_TODO_GATEWAY_URL"),
    allowedOrigins: csv(requiredEnvironment("CAES_AI_ALLOWED_ORIGINS")),
    allowedModels: csv(requiredEnvironment("OPENAI_ALLOWED_MODELS")),
    maximumReasoningEffort: "medium",
    keyLabel: "local-demo",
  }, requiredEnvironment("TODO_APP_API_KEY"),
  process.env.CAES_AI_ALLOW_INSECURE_CALLBACKS?.toLowerCase() === "true");
  console.log(`${result.created ? "Created" : "Updated"} local Todo registration.`);
} finally {
  await closeDatabase(database);
}
