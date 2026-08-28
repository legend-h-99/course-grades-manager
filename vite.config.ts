import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sites } from "@openai/sites-vite-plugin";

export default defineConfig({
  base: process.env.VITE_BASE_URL ?? "/",
  plugins: [react(), tailwindcss(), sites()],
  resolve: {
    alias: {
      "@": import.meta.dirname + "/src",
    },
  },
});
