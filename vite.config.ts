import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { publishTemplatePlugin } from "./vite-plugin-publish-template";

export default defineConfig({
  plugins: [react(), publishTemplatePlugin()],
  server: { port: 5173, open: true },
});
