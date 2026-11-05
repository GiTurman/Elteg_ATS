// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";

import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const EVENTS_POLYFILL = fileURLToPath(new URL("./node_modules/events/events.js", import.meta.url));

export default defineConfig({
  // JsSIP (ბრაუზერის ტელეფონი) იყენებს Node-ის `events` მოდულს — ბრაუზერის ბილდში npm-ის პოლიფილით
  vite: {
    plugins: [
      {
        name: "gt-events-polyfill",
        enforce: "pre",
        resolveId(source: string, importer?: string, options?: { ssr?: boolean | undefined }) {
          if (options?.ssr) return null;
          if ((source === "events" || source === "node:events") && importer?.includes("jssip")) {
            return EVENTS_POLYFILL;
          }
          return null;
        },
      },
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
