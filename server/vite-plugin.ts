import type { Plugin } from "vite";
import { createSuggestHandler } from "./suggest-api.ts";

/** Adds the suggestion endpoint to `vite dev` and `vite preview`. */
export function suggestApi(getKey: () => string | undefined): Plugin {
  const handler = createSuggestHandler(getKey);
  return {
    name: "playtest-desk-suggest-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
