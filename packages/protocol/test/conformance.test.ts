import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as protocol from "../src/index.js";

const root = new URL("../../../contracts/v1/", import.meta.url);
const document = JSON.parse(readFileSync(new URL("protocol.schema.json", root), "utf8"));
const cases = JSON.parse(readFileSync(new URL("fixtures/conformance.json", root), "utf8")) as Array<{
  name: string; definition: string; valid: boolean; value: unknown;
}>;
const Constructor = Ajv2020 as unknown as new (options: Record<string, unknown>) => {
  addSchema(value: unknown): void; validate(ref: string, value: unknown): boolean; errors: unknown;
};
const ajv = new Constructor({ strict: true, allErrors: true });
(addFormats as unknown as (ajv: unknown) => void)(ajv);
ajv.addSchema(document);

describe("shared receiver conformance", () => {
  it.each(cases)("$name", ({ definition, valid, value }) => {
    const schema = (protocol as unknown as Record<string, z.ZodType>)[`${definition}Schema`]!;
    expect(schema.safeParse(value).success).toBe(valid);
    expect(ajv.validate(`${document.$id}#/$defs/${definition}`, value), JSON.stringify(ajv.errors)).toBe(valid);
  });
  it.each(["chatRequestEnvelope", "chatStreamEvent"])("keeps the %s wire definition synchronized", (name) => {
    const schema = (protocol as unknown as Record<string, z.ZodType>)[`${name}Schema`]!;
    const generated = z.toJSONSchema(schema, { io: "input", reused: "ref" });
    delete generated.$schema;
    expect(document.$defs[name]).toEqual(JSON.parse(JSON.stringify(generated).replaceAll("#/$defs/", `#/$defs/${name}/$defs/`)));
  });
});
