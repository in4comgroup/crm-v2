import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const src = fileURLToPath(new URL("./src", import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // `server-only` throws outside a server bundle; tests get an empty module.
      { find: "server-only", replacement: `${src}/test/empty.ts` },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
