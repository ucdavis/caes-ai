import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  callbackAudience,
  callbackTokenSubject,
  callbackTokenType,
  Es256CallbackTokenIssuer,
  FileCallbackTokenIssuer,
  hashCallbackBody,
} from "../src/security/callback-tokens.js";

const now = new Date("2026-09-02T12:00:00Z");

const input = {
  applicationId: "todo-app",
  sessionId: "08ab127b-2fd4-4f4c-9348-034f66365d49",
  toolCallId: "call-123",
  toolName: "list_todos",
  toolManifestHash: "a".repeat(64),
  requestBody: JSON.stringify({ hello: "world" }),
};

const temporaryDirectories: string[] = [];

describe("callback token issuer", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })));
  });
  it("binds a short-lived ES256 token to the application and exact request", async () => {
    const issuer = new Es256CallbackTokenIssuer("https://caes-ai.test", 60_000, () => now);
    const token = await issuer.issue(input);
    const header = decodeProtectedHeader(token);
    const verified = await jwtVerify(token, createLocalJWKSet(issuer.getJwks()), {
      algorithms: ["ES256"],
      issuer: "https://caes-ai.test",
      audience: callbackAudience("todo-app"),
      currentDate: now,
      typ: callbackTokenType,
    });

    expect(header).toMatchObject({ alg: "ES256", typ: callbackTokenType });
    expect(header.kid).toBeTypeOf("string");
    expect(verified.payload).toMatchObject({
      sub: callbackTokenSubject,
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      toolManifestHash: input.toolManifestHash,
      requestHash: hashCallbackBody(input.requestBody),
    });
    expect(verified.payload.exp! - verified.payload.iat!).toBe(60);
    expect(verified.payload.jti).toBeTypeOf("string");
  });

  it("publishes old and new public keys during rotation overlap", async () => {
    const issuer = new Es256CallbackTokenIssuer("https://caes-ai.test", 60_000, () => now);
    const oldToken = await issuer.issue(input);
    const oldKid = decodeProtectedHeader(oldToken).kid;
    const newKid = issuer.rotate();
    const newToken = await issuer.issue({ ...input, toolCallId: "call-456" });
    const keySet = createLocalJWKSet(issuer.getJwks());

    expect(newKid).not.toBe(oldKid);
    expect(decodeProtectedHeader(newToken).kid).toBe(newKid);
    await expect(jwtVerify(oldToken, keySet, { currentDate: now })).resolves.toBeDefined();
    await expect(jwtVerify(newToken, keySet, { currentDate: now })).resolves.toBeDefined();
    expect(issuer.getJwks().keys.every((key) => !key.d)).toBe(true);
  });

  it("persists private signing keys and supports explicit overlap rotation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "caes-ai-signing-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "callback-keys.json");
    const firstProcess = await FileCallbackTokenIssuer.load(
      "https://caes-ai.test",
      60_000,
      path,
      () => now,
    );
    const oldToken = await firstProcess.issue(input);
    const oldKid = decodeProtectedHeader(oldToken).kid;

    const restarted = await FileCallbackTokenIssuer.load(
      "https://caes-ai.test",
      60_000,
      path,
      () => now,
    );
    expect(decodeProtectedHeader(await restarted.issue(input)).kid).toBe(oldKid);

    const newKid = await restarted.rotate();
    const afterRotation = await FileCallbackTokenIssuer.load(
      "https://caes-ai.test",
      60_000,
      path,
      () => now,
    );
    expect(decodeProtectedHeader(await afterRotation.issue(input)).kid).toBe(newKid);
    expect(afterRotation.getJwks().keys.map((key) => key.kid))
      .toEqual([newKid, oldKid]);
    expect(await readFile(path, "utf8")).not.toContain("BEGIN PRIVATE KEY");

    await afterRotation.retire(oldKid!);
    const afterRetirement = await FileCallbackTokenIssuer.load(
      "https://caes-ai.test",
      60_000,
      path,
      () => now,
    );
    expect(afterRetirement.getJwks().keys.map((key) => key.kid)).toEqual([newKid]);
  });
});
