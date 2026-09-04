import { createHash, timingSafeEqual } from "node:crypto";

import type {
  ApplicationRegistry,
  RegisteredApplication,
} from "../../src/applications/registry.js";

export interface StaticApplicationConfig extends RegisteredApplication {
  apiKey: string;
}

function hashApiKey(apiKey: string): Buffer {
  return createHash("sha256").update(apiKey, "utf8").digest();
}

export class StaticApplicationRegistry implements ApplicationRegistry {
  readonly #applications: Array<RegisteredApplication & { apiKeyHash: Buffer }>;

  constructor(configurations: StaticApplicationConfig[]) {
    this.#applications = configurations.map(({ apiKey, ...application }) => ({
      ...application,
      apiKeyHash: hashApiKey(apiKey),
    }));
  }

  async authenticate(apiKey: string): Promise<RegisteredApplication | undefined> {
    const candidate = hashApiKey(apiKey);
    const found = this.#applications.find((application) =>
      timingSafeEqual(candidate, application.apiKeyHash));
    if (!found) return undefined;
    return {
      id: found.id,
      toolCallbackUrl: found.toolCallbackUrl,
      allowedOrigins: found.allowedOrigins,
      allowedModels: found.allowedModels,
      maximumReasoningEffort: found.maximumReasoningEffort,
    };
  }

  async isOriginAllowed(origin: string): Promise<boolean> {
    return this.#applications.some((application) =>
      application.allowedOrigins.includes(origin));
  }

  async isApplicationEnabled(applicationId: string): Promise<boolean> {
    return this.#applications.some((application) => application.id === applicationId);
  }

  async checkHealth(): Promise<void> {}
}
