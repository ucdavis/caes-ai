import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/ui.ts", "src/theme.css"],
  format: ["esm"],
  dts: { entry: ["src/index.ts", "src/ui.ts"] },
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom"],
  loader: { ".css": "copy" },
});
