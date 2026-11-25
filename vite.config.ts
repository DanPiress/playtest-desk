import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { suggestApi } from "./server/vite-plugin.ts";

export default defineConfig(({ mode }) => {
  if (mode === "demo") return { plugins: [react()] };

  // Loads .env / .env.local for the server only. The empty prefix reads every variable here,
  // but Vite still exposes only VITE_-prefixed ones to the browser, and this app defines none.
  const env = loadEnv(mode, process.cwd(), "");
  const key = env.ANTHROPIC_API_KEY?.trim() || undefined;
  return {
    plugins: [react(), suggestApi(() => key)],
  };
});
