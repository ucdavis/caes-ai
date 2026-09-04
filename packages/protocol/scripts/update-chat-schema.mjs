import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";
import { z } from "zod";
import * as profile from "../dist/chat-profile.js";

const path = new URL("../../../contracts/v1/protocol.schema.json", import.meta.url);
const schema = JSON.parse(readFileSync(path, "utf8"));
for (const name of ["chatRequestEnvelope", "chatStreamEvent"]) {
  const generated = z.toJSONSchema(profile[`${name}Schema`], { io: "input", reused: "ref" });
  delete generated.$schema;
  schema.$defs[name] = JSON.parse(JSON.stringify(generated).replaceAll("#/$defs/", `#/$defs/${name}/$defs/`));
}
writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
