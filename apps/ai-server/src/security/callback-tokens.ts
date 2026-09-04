import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { SignJWT, type JWK } from "jose";

export const callbackTokenAlgorithm = "ES256";
export const callbackTokenType = "caes-ai-tool-callback+jwt";
export const callbackTokenSubject = "caes-ai-tool-service";

export interface CallbackTokenInput {
  applicationId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  toolManifestHash: string;
  requestBody: string;
}

export interface CallbackTokenIssuer {
  readonly issuer: string;
  issue(input: CallbackTokenInput): Promise<string>;
  getJwks(): { keys: JWK[] };
}

interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: JWK;
}

interface PersistedSigningKey {
  kid: string;
  createdAt: string;
  privateJwk: JWK;
}

interface PersistedKeyRing {
  version: 1;
  activeKid: string;
  keys: PersistedSigningKey[];
}

function createSigningKey(): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const kid = randomUUID();
  const publicJwk = publicKey.export({ format: "jwk" }) as JWK;
  return {
    kid,
    privateKey,
    publicJwk: {
      ...publicJwk,
      alg: callbackTokenAlgorithm,
      kid,
      use: "sig",
    },
  };
}

function signingKeyFromJwk(key: PersistedSigningKey): SigningKey {
  const publicJwk = { ...key.privateJwk };
  Reflect.deleteProperty(publicJwk, "d");
  return {
    kid: key.kid,
    privateKey: createPrivateKey({ key: key.privateJwk, format: "jwk" }),
    publicJwk: {
      ...publicJwk,
      alg: callbackTokenAlgorithm,
      kid: key.kid,
      use: "sig",
    },
  };
}

async function issueToken(
  key: SigningKey,
  issuer: string,
  ttlMs: number,
  now: Date,
  input: CallbackTokenInput,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAt = issuedAt + Math.ceil(ttlMs / 1_000);

  return new SignJWT({
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    toolManifestHash: input.toolManifestHash,
    requestHash: hashCallbackBody(input.requestBody),
  })
    .setProtectedHeader({
      alg: callbackTokenAlgorithm,
      kid: key.kid,
      typ: callbackTokenType,
    })
    .setIssuer(issuer)
    .setAudience(callbackAudience(input.applicationId))
    .setSubject(callbackTokenSubject)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt - 1)
    .setExpirationTime(expiresAt)
    .sign(key.privateKey);
}

export function callbackAudience(applicationId: string): string {
  return `caes-ai-app:${applicationId}`;
}

export function hashCallbackBody(requestBody: string): string {
  return createHash("sha256").update(requestBody, "utf8").digest("base64url");
}

/**
 * Issues short-lived, application-scoped callback tokens. Production can
 * replace this with a Key Vault-backed issuer without changing the wire contract.
 */
export class Es256CallbackTokenIssuer implements CallbackTokenIssuer {
  readonly #keys: SigningKey[] = [createSigningKey()];

  constructor(
    readonly issuer: string,
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(input: CallbackTokenInput): Promise<string> {
    return issueToken(this.#keys[0]!, this.issuer, this.ttlMs, this.now(), input);
  }

  getJwks(): { keys: JWK[] } {
    return { keys: this.#keys.map((key) => ({ ...key.publicJwk })) };
  }

  /** Rotates the active key while retaining the previous public key for overlap. */
  rotate(): string {
    const key = createSigningKey();
    this.#keys.unshift(key);
    return key.kid;
  }
}

/**
 * Persists callback signing material outside configuration and environment
 * variables. Rotation keeps old public keys available for an overlap window.
 */
export class FileCallbackTokenIssuer implements CallbackTokenIssuer {
  readonly #keys: SigningKey[];

  private constructor(
    readonly issuer: string,
    private readonly ttlMs: number,
    private readonly path: string,
    private keyRing: PersistedKeyRing,
    private readonly now: () => Date,
  ) {
    const byId = new Map(
      keyRing.keys.map((key) => [key.kid, signingKeyFromJwk(key)]),
    );
    const active = byId.get(keyRing.activeKid);
    if (!active) throw new Error("The callback signing key ring has no active key.");
    this.#keys = [
      active,
      ...keyRing.keys
        .filter((key) => key.kid !== keyRing.activeKid)
        .map((key) => byId.get(key.kid)!),
    ];
  }

  static async load(
    issuer: string,
    ttlMs: number,
    path: string,
    now: () => Date = () => new Date(),
  ): Promise<FileCallbackTokenIssuer> {
    let keyRing: PersistedKeyRing;
    try {
      keyRing = JSON.parse(await readFile(path, "utf8")) as PersistedKeyRing;
      validateKeyRing(keyRing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const generated = createSigningKey();
      keyRing = {
        version: 1,
        activeKid: generated.kid,
        keys: [{
          kid: generated.kid,
          createdAt: now().toISOString(),
          privateJwk: generated.privateKey.export({ format: "jwk" }),
        }],
      };
      await persistKeyRing(path, keyRing);
    }
    return new FileCallbackTokenIssuer(issuer, ttlMs, path, keyRing, now);
  }

  async issue(input: CallbackTokenInput): Promise<string> {
    return issueToken(this.#keys[0]!, this.issuer, this.ttlMs, this.now(), input);
  }

  getJwks(): { keys: JWK[] } {
    return { keys: this.#keys.map((key) => ({ ...key.publicJwk })) };
  }

  async rotate(): Promise<string> {
    const generated = createSigningKey();
    const persistedKey: PersistedSigningKey = {
      kid: generated.kid,
      createdAt: this.now().toISOString(),
      privateJwk: generated.privateKey.export({ format: "jwk" }),
    };
    this.keyRing = {
      ...this.keyRing,
      activeKid: generated.kid,
      keys: [persistedKey, ...this.keyRing.keys],
    };
    await persistKeyRing(this.path, this.keyRing);
    this.#keys.unshift(signingKeyFromJwk(persistedKey));
    return generated.kid;
  }

  async retire(kid: string): Promise<void> {
    if (kid === this.keyRing.activeKid) {
      throw new Error("The active callback signing key cannot be retired.");
    }
    const keys = this.keyRing.keys.filter((key) => key.kid !== kid);
    if (keys.length === this.keyRing.keys.length) {
      throw new Error(`Callback signing key ${kid} was not found.`);
    }
    this.keyRing = { ...this.keyRing, keys };
    await persistKeyRing(this.path, this.keyRing);
    const index = this.#keys.findIndex((key) => key.kid === kid);
    if (index >= 0) this.#keys.splice(index, 1);
  }
}

function validateKeyRing(value: PersistedKeyRing): void {
  if (
    value.version !== 1 ||
    !value.activeKid ||
    !Array.isArray(value.keys) ||
    value.keys.length === 0 ||
    !value.keys.some((key) => key.kid === value.activeKid)
  ) {
    throw new Error("The callback signing key ring is invalid.");
  }
}

async function persistKeyRing(path: string, keyRing: PersistedKeyRing): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(keyRing, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}
