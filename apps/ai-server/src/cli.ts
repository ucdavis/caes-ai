import "dotenv/config";

import type { ReasoningEffort } from "@ucdavis/caes-ai-protocol";

import { ApplicationAdminService } from "./applications/admin.js";
import { requiredEnvironment } from "./config.js";
import {
  closeDatabase,
  createDatabase,
  migrateDatabase,
} from "./database/client.js";
import { FileCallbackTokenIssuer } from "./security/callback-tokens.js";

interface ParsedArguments {
  positionals: string[];
  flags: Map<string, string[]>;
}

function parseArguments(args: string[]): ParsedArguments {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    const value = args[++index];
    if (!name || !value || value.startsWith("--")) {
      throw new Error(`Option --${name || "unknown"} requires a value.`);
    }
    flags.set(name, [...(flags.get(name) || []), value]);
  }
  return { positionals, flags };
}

function one(parsed: ParsedArguments, name: string, fallback?: string): string {
  const values = parsed.flags.get(name);
  if (!values?.length) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required option --${name}.`);
  }
  if (values.length !== 1) {
    throw new Error(`Option --${name} may be supplied only once.`);
  }
  return values[0]!;
}

function many(parsed: ParsedArguments, name: string): string[] {
  const values = parsed.flags.get(name);
  if (!values?.length) throw new Error(`Supply at least one --${name}.`);
  return values;
}

function optional(parsed: ParsedArguments, name: string): string | undefined {
  const values = parsed.flags.get(name);
  if (!values?.length) return undefined;
  if (values.length !== 1) {
    throw new Error(`Option --${name} may be supplied only once.`);
  }
  return values[0];
}

function printKey(result: { applicationId: string; keyId: string; apiKey: string }): void {
  console.log(`Application: ${result.applicationId}`);
  console.log(`Key ID: ${result.keyId}`);
  console.log("API key, shown once:");
  console.log(result.apiKey);
}

function printHelp(): void {
  console.log(`CAES AI administration

  pnpm caes-ai app create <id> --callback-url <url> --origin <url> --model <model> [--display-name <name>] [--max-reasoning <effort>]
  pnpm caes-ai app update <id> [--callback-url <url>] [--origin <url>] [--model <model>] [--display-name <name>] [--max-reasoning <effort>]
  pnpm caes-ai app list
  pnpm caes-ai app rotate-key <id> [--label <label>]
  pnpm caes-ai app revoke-key <id> <key-id>
  pnpm caes-ai app enable <id>
  pnpm caes-ai app disable <id>
  pnpm caes-ai signing-key list
  pnpm caes-ai signing-key rotate
  pnpm caes-ai signing-key retire <kid>
  pnpm caes-ai db migrate`);
}

async function runSigningKeyCommand(command: string | undefined, positionals: string[]) {
  const issuer = process.env.CAES_AI_CALLBACK_ISSUER?.trim() ||
    process.env.CAES_AI_PUBLIC_BASE_URL?.trim() || "http://localhost:4310";
  const ttlMs = Number(process.env.CAES_AI_CALLBACK_TOKEN_TTL_MS || 60_000);
  const path = process.env.CAES_AI_CALLBACK_SIGNING_KEYS_PATH?.trim() ||
    ".data/callback-signing-keys.json";
  const issuerService = await FileCallbackTokenIssuer.load(issuer, ttlMs, path);
  if (command === "list") {
    console.table(issuerService.getJwks().keys.map((key, index) => ({
      kid: key.kid,
      active: index === 0,
      algorithm: key.alg,
    })));
    return;
  }
  if (command === "rotate") {
    const kid = await issuerService.rotate();
    console.log(`Created callback signing key ${kid}.`);
    console.log("Restart CAES AI to activate it; the previous key remains published for overlap.");
    return;
  }
  if (command === "retire") {
    const kid = positionals[0];
    if (!kid) throw new Error("Callback signing key ID is required.");
    await issuerService.retire(kid);
    console.log(`Retired callback signing key ${kid}. Restart CAES AI to republish JWKS.`);
    return;
  }
  throw new Error("Unknown signing-key command. Run pnpm caes-ai help for usage.");
}

async function run(): Promise<void> {
  const argumentsToParse = process.argv.slice(2);
  if (argumentsToParse.includes("--help")) {
    printHelp();
    return;
  }
  const parsed = parseArguments(argumentsToParse);
  const [area, command, ...positionals] = parsed.positionals;
  if (!area || area === "help") {
    printHelp();
    return;
  }

  if (area === "signing-key") {
    await runSigningKeyCommand(command, positionals);
    return;
  }

  const database = createDatabase(requiredEnvironment("DATABASE_URL"));
  try {
    await migrateDatabase(database);
    if (area === "db" && command === "migrate") {
      console.log("Database migrations are current.");
      return;
    }
    if (area !== "app" || !command) {
      throw new Error("Unknown command. Run pnpm caes-ai help for usage.");
    }

    const admin = new ApplicationAdminService(
      database,
      process.env.CAES_AI_ALLOW_INSECURE_CALLBACKS?.toLowerCase() === "true",
    );
    if (command === "create") {
      const id = positionals[0];
      if (!id) throw new Error("Application ID is required.");
      const result = await admin.create({
        id,
        displayName: one(parsed, "display-name", id),
        toolCallbackUrl: one(parsed, "callback-url"),
        allowedOrigins: many(parsed, "origin"),
        allowedModels: many(parsed, "model"),
        maximumReasoningEffort: one(parsed, "max-reasoning", "medium") as ReasoningEffort,
        keyLabel: one(parsed, "key-label", "default"),
      });
      printKey(result);
      return;
    }
    if (command === "list") {
      const rows = await admin.list();
      console.table(rows.map((application) => ({
        id: application.id,
        enabled: application.enabled,
        callback: application.toolCallbackUrl,
        models: application.allowedModels.join(","),
        maximumReasoning: application.maximumReasoningEffort,
        activeKeyIds: application.activeKeyIds.join(","),
      })));
      return;
    }
    if (command === "update") {
      const id = positionals[0];
      if (!id) throw new Error("Application ID is required.");
      const origins = parsed.flags.get("origin");
      const models = parsed.flags.get("model");
      const displayName = optional(parsed, "display-name");
      const toolCallbackUrl = optional(parsed, "callback-url");
      const maximumReasoningEffort = optional(parsed, "max-reasoning") as
        | ReasoningEffort
        | undefined;
      if (!origins && !models && !displayName && !toolCallbackUrl &&
          !maximumReasoningEffort) {
        throw new Error("Supply at least one application setting to update.");
      }
      await admin.update(id, {
        ...(displayName ? { displayName } : {}),
        ...(toolCallbackUrl ? { toolCallbackUrl } : {}),
        ...(origins ? { allowedOrigins: origins } : {}),
        ...(models ? { allowedModels: models } : {}),
        ...(maximumReasoningEffort ? { maximumReasoningEffort } : {}),
      });
      console.log(`Updated ${id}.`);
      return;
    }
    if (command === "rotate-key") {
      const id = positionals[0];
      if (!id) throw new Error("Application ID is required.");
      const result = await admin.rotateKey(id, one(parsed, "label", "rotated"));
      printKey(result);
      console.log("Existing keys remain active until explicitly revoked.");
      return;
    }
    if (command === "revoke-key") {
      const [id, keyId] = positionals;
      if (!id || !keyId) throw new Error("Application ID and key ID are required.");
      await admin.revokeKey(id, keyId);
      console.log(`Revoked key ${keyId} for ${id}.`);
      return;
    }
    if (command === "enable" || command === "disable") {
      const id = positionals[0];
      if (!id) throw new Error("Application ID is required.");
      await admin.setEnabled(id, command === "enable");
      console.log(`${command === "enable" ? "Enabled" : "Disabled"} ${id}.`);
      return;
    }
    throw new Error("Unknown command. Run pnpm caes-ai help for usage.");
  } finally {
    await closeDatabase(database);
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "CAES AI administration failed.");
  process.exitCode = 1;
}
