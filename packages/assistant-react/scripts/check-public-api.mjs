import { readFile, readdir } from "node:fs/promises";
import { URL } from "node:url";

const declarations = (await readdir(new URL("../dist/", import.meta.url)))
  .filter((name) => name.endsWith(".d.ts"));
const forbidden = ["@tanstack/", "AnyClientTool", "ConnectConnectionAdapter", "UIMessage"];

await Promise.all(declarations.map(async (name) => {
  const contents = await readFile(new URL(`../dist/${name}`, import.meta.url), "utf8");
  const leaked = forbidden.find((value) => contents.includes(value));
  if (leaked) {
    throw new Error(`${name} exposes internal TanStack type ${leaked}.`);
  }
}));
