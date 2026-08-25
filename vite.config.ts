import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sites } from "@openai/sites-vite-plugin";

export default defineConfig({
  base: process.env.VITE_BASE_URL ?? "/",
  plugins: [react(), sites()]
});
