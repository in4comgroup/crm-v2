import { fileURLToPath } from "node:url"
import { config } from "dotenv"
import { defineConfig } from "vitest/config"

// `pnpm chat:eval` — the AI chat eval (docs/specs/ai-chat §12): real models,
// the DB of `.env` (the test DB). Not part of `pnpm test`.
config({ path: ".env", quiet: true })

const src = fileURLToPath(new URL("./src", import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: "server-only", replacement: `${src}/test/empty.ts` },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/server/chat/eval/**/*.eval.ts"],
    testTimeout: 60 * 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
