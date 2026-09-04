import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/** Compile one independent schema without retaining a process-wide schema cache. */
export function compileToolSchema(schema: Record<string, unknown>): (value: unknown) => boolean {
  const Constructor = Ajv2020 as unknown as new (options: Record<string, unknown>) => {
    compile(schema: Record<string, unknown>): (value: unknown) => boolean;
  };
  const compiler = new Constructor({ allErrors: true, strict: true, validateFormats: true });
  (addFormats as unknown as (compiler: unknown) => void)(compiler);
  return compiler.compile(schema);
}
