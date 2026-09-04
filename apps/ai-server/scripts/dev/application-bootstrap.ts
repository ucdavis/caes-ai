import { eq } from "drizzle-orm";

import {
  validateApplication,
  type CreateApplicationInput,
} from "../../src/applications/admin.js";
import { parseApplicationApiKey } from "../../src/applications/registry.js";
import type { CaesAiDatabase } from "../../src/database/client.js";
import {
  applicationApiKeys,
  applications,
} from "../../src/database/schema.js";

export async function bootstrapApplication(
  database: CaesAiDatabase,
  input: CreateApplicationInput,
  apiKey: string,
  allowInsecureCallbacks = false,
): Promise<{ created: boolean; keyId: string }> {
  const application = validateApplication(input, allowInsecureCallbacks);
  const key = parseApplicationApiKey(apiKey);
  if (!key) {
    throw new Error("Imported API keys must use the CAES AI application-key format.");
  }

  return database.db.transaction(async (transaction) => {
    const existing = await transaction
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.id, application.id))
      .limit(1);
    const existingKey = await transaction
      .select({
        applicationId: applicationApiKeys.applicationId,
        keyHash: applicationApiKeys.keyHash,
      })
      .from(applicationApiKeys)
      .where(eq(applicationApiKeys.keyId, key.keyId))
      .limit(1);
    if (existingKey[0] && (
      existingKey[0].applicationId !== application.id ||
      !existingKey[0].keyHash.equals(key.keyHash)
    )) {
      // A public key ID must never be silently reassigned to another credential.
      throw new Error(`Application key ID ${key.keyId} is already in use.`);
    }
    await transaction.insert(applications).values({
      id: application.id,
      displayName: application.displayName,
      toolCallbackUrl: application.toolCallbackUrl,
      allowedOrigins: application.allowedOrigins,
      allowedModels: application.allowedModels,
      maximumReasoningEffort: application.maximumReasoningEffort,
    }).onConflictDoUpdate({
      target: applications.id,
      set: {
        displayName: application.displayName,
        toolCallbackUrl: application.toolCallbackUrl,
        allowedOrigins: application.allowedOrigins,
        allowedModels: application.allowedModels,
        maximumReasoningEffort: application.maximumReasoningEffort,
        enabled: true,
        updatedAt: new Date(),
      },
    });
    await transaction.insert(applicationApiKeys).values({
      applicationId: application.id,
      keyId: key.keyId,
      keyHash: key.keyHash,
      label: application.keyLabel!,
    }).onConflictDoUpdate({
      target: applicationApiKeys.keyId,
      set: {
        applicationId: application.id,
        keyHash: key.keyHash,
        label: application.keyLabel!,
        revokedAt: null,
      },
    });
    return { created: existing.length === 0, keyId: key.keyId };
  });
}
