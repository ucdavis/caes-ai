import { createHash, randomBytes } from "node:crypto";

import {
  reasoningEffortSchema,
  type ReasoningEffort,
} from "@ucdavis/caes-ai-protocol";
import { and, eq, isNull } from "drizzle-orm";

import type { CaesAiDatabase } from "../database/client.js";
import { applicationApiKeys, applications } from "../database/schema.js";

export interface CreateApplicationInput {
  id: string;
  displayName: string;
  toolCallbackUrl: string;
  allowedOrigins: string[];
  allowedModels: string[];
  maximumReasoningEffort: ReasoningEffort;
  keyLabel?: string;
}

export interface ApplicationSummary {
  id: string;
  displayName: string;
  toolCallbackUrl: string;
  allowedOrigins: string[];
  allowedModels: string[];
  maximumReasoningEffort: ReasoningEffort;
  enabled: boolean;
  activeKeyIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedApplicationKey {
  applicationId: string;
  keyId: string;
  apiKey: string;
}

export type UpdateApplicationInput = Partial<Pick<
  CreateApplicationInput,
  | "displayName"
  | "toolCallbackUrl"
  | "allowedOrigins"
  | "allowedModels"
  | "maximumReasoningEffort"
>>;

export function validateApplication(
  input: CreateApplicationInput,
  allowInsecureCallbacks = false,
): CreateApplicationInput {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(input.id)) {
    throw new Error("Application ID must be a lowercase identifier.");
  }
  if (!input.displayName.trim() || input.displayName.trim().length > 120) {
    throw new Error("Display name must contain 1 to 120 characters.");
  }
  const callback = new URL(input.toolCallbackUrl);
  const loopback = callback.hostname === "localhost" ||
    callback.hostname === "127.0.0.1" || callback.hostname === "::1";
  if (
    callback.protocol !== "https:" &&
    !(callback.protocol === "http:" && (loopback || allowInsecureCallbacks))
  ) {
    throw new Error("Tool callback URL must use HTTPS outside local development.");
  }
  const allowedOrigins = normalizeUrls(input.allowedOrigins, "origin");
  const allowedModels = normalizeValues(input.allowedModels, "model");
  const maximumReasoningEffort = reasoningEffortSchema.parse(input.maximumReasoningEffort);
  const keyLabel = input.keyLabel?.trim() || "default";
  if (keyLabel.length > 80) {
    throw new Error("Key label must contain at most 80 characters.");
  }
  return {
    ...input,
    displayName: input.displayName.trim(),
    toolCallbackUrl: callback.toString(),
    allowedOrigins,
    allowedModels,
    maximumReasoningEffort,
    keyLabel,
  };
}

function normalizeUrls(values: string[], label: string): string[] {
  const normalized = normalizeValues(values, label).map((value) => {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
        url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`Allowed ${label}s must be HTTP origins without a path.`);
    }
    return url.origin;
  });
  return [...new Set(normalized)];
}

function normalizeValues(values: string[], label: string): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new Error(`At least one ${label} is required.`);
  }
  return normalized;
}

function generateApplicationKey(): CreatedApplicationKey & { keyHash: Buffer } {
  const keyId = randomBytes(8).toString("hex");
  const apiKey = `caesai_app_${keyId}_${randomBytes(32).toString("base64url")}`;
  return {
    applicationId: "",
    keyId,
    apiKey,
    keyHash: createHash("sha256").update(apiKey, "utf8").digest(),
  };
}

export class ApplicationAdminService {
  constructor(
    private readonly database: CaesAiDatabase,
    private readonly allowInsecureCallbacks = false,
  ) {}

  async create(input: CreateApplicationInput): Promise<CreatedApplicationKey> {
    const application = validateApplication(input, this.allowInsecureCallbacks);
    const generated = generateApplicationKey();
    await this.database.db.transaction(async (transaction) => {
      await transaction.insert(applications).values({
        id: application.id,
        displayName: application.displayName,
        toolCallbackUrl: application.toolCallbackUrl,
        allowedOrigins: application.allowedOrigins,
        allowedModels: application.allowedModels,
        maximumReasoningEffort: application.maximumReasoningEffort,
      });
      await transaction.insert(applicationApiKeys).values({
        applicationId: application.id,
        keyId: generated.keyId,
        keyHash: generated.keyHash,
        label: application.keyLabel!,
      });
    });
    return {
      applicationId: application.id,
      keyId: generated.keyId,
      apiKey: generated.apiKey,
    };
  }

  async rotateKey(applicationId: string, label = "rotated"): Promise<CreatedApplicationKey> {
    const normalizedLabel = label.trim() || "rotated";
    if (normalizedLabel.length > 80) {
      throw new Error("Key label must contain at most 80 characters.");
    }
    const application = await this.database.db
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .limit(1);
    if (application.length !== 1) {
      throw new Error(`Application ${applicationId} was not found.`);
    }
    const generated = generateApplicationKey();
    const inserted = await this.database.db
      .insert(applicationApiKeys)
      .values({
        applicationId,
        keyId: generated.keyId,
        keyHash: generated.keyHash,
        label: normalizedLabel,
      })
      .returning({ applicationId: applicationApiKeys.applicationId });
    if (inserted.length !== 1) throw new Error("Key creation failed.");
    return { applicationId, keyId: generated.keyId, apiKey: generated.apiKey };
  }

  async update(applicationId: string, changes: UpdateApplicationInput): Promise<void> {
    const [existing] = await this.database.db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId))
      .limit(1);
    if (!existing) {
      throw new Error(`Application ${applicationId} was not found.`);
    }
    const updated = validateApplication({
      id: applicationId,
      displayName: changes.displayName ?? existing.displayName,
      toolCallbackUrl: changes.toolCallbackUrl ?? existing.toolCallbackUrl,
      allowedOrigins: changes.allowedOrigins ?? existing.allowedOrigins,
      allowedModels: changes.allowedModels ?? existing.allowedModels,
      maximumReasoningEffort: changes.maximumReasoningEffort ??
        existing.maximumReasoningEffort,
    }, this.allowInsecureCallbacks);
    await this.database.db
      .update(applications)
      .set({
        displayName: updated.displayName,
        toolCallbackUrl: updated.toolCallbackUrl,
        allowedOrigins: updated.allowedOrigins,
        allowedModels: updated.allowedModels,
        maximumReasoningEffort: updated.maximumReasoningEffort,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, applicationId));
  }

  async revokeKey(applicationId: string, keyId: string): Promise<void> {
    const revoked = await this.database.db
      .update(applicationApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(applicationApiKeys.applicationId, applicationId),
        eq(applicationApiKeys.keyId, keyId),
        isNull(applicationApiKeys.revokedAt),
      ))
      .returning({ keyId: applicationApiKeys.keyId });
    if (revoked.length !== 1) {
      throw new Error(`Active key ${keyId} was not found for ${applicationId}.`);
    }
  }

  async setEnabled(applicationId: string, enabled: boolean): Promise<void> {
    const changed = await this.database.db
      .update(applications)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(applications.id, applicationId))
      .returning({ id: applications.id });
    if (changed.length !== 1) {
      throw new Error(`Application ${applicationId} was not found.`);
    }
  }

  async list(): Promise<ApplicationSummary[]> {
    const applicationRows = await this.database.db.select().from(applications)
      .orderBy(applications.id);
    const keyRows = await this.database.db
      .select({
        applicationId: applicationApiKeys.applicationId,
        keyId: applicationApiKeys.keyId,
      })
      .from(applicationApiKeys)
      .where(isNull(applicationApiKeys.revokedAt))
      .orderBy(applicationApiKeys.createdAt);
    return applicationRows.map((application) => ({
      ...application,
      activeKeyIds: keyRows
        .filter((key) => key.applicationId === application.id)
        .map((key) => key.keyId),
    }));
  }

}
