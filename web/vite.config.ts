import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths, so the build works under GitHub Pages' /<repo-name>/ path.
  base: "./",
  build: { target: "es2022" }, // top-level await in main.tsx
});
