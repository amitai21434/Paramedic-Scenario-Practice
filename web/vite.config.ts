import { execFileSync } from "node:child_process";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev server only: serves the private scenario content straight from
 * ../content (rebuilt on every request, so edits show up on refresh).
 * The production build never contains it — the site loads it from Supabase.
 */
function devContent(): Plugin {
  const script = path.resolve(import.meta.dirname, "../reference/content.mjs");
  return {
    name: "dev-content",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/dev-content.json", (_req, res) => {
        try {
          const json = execFileSync(process.execPath, [script], { encoding: "utf8" });
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(json);
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devContent()],
  // Relative asset paths, so the build works under GitHub Pages' /<repo-name>/ path.
  base: "./",
  build: { target: "es2022" }, // top-level await in main.tsx
});
