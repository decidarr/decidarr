import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.URL_BASE || "/",
  server: { proxy: { "/api": "http://localhost:5454" } },
});
