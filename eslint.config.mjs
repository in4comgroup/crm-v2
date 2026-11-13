import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Workflow SDK auto-generated route handlers — bundled JS with
    // a vestigial `/* eslint-disable */` comment that ESLint warns
    // about as "unused". Source of truth is src/workflows/*.workflow.ts.
    "src/app/.well-known/workflow/**",
  ]),
  // AI layer boundaries (docs/specs/models/01-gateway-providers.md §3).
  // Business code calls models only through src/server/ai (aiGenerateText /
  // aiStreamText with a process key) and never names a gateway, a vendor
  // package or a model id. Gateway / vendor specifics live only in
  // src/server/ai/gateways/** and src/server/ai/catalog-sources/**.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/ai/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ai",
              importNames: [
                "generateText",
                "streamText",
                "generateObject",
                "streamObject",
                "createGateway",
                "gateway",
              ],
              message:
                "Call models through aiGenerateText / aiStreamText from @/server/ai/runtime with a process key.",
            },
          ],
          patterns: [
            {
              group: ["@ai-sdk/*", "!@ai-sdk/react"],
              message:
                "Vendor / gateway packages belong in src/server/ai/gateways only. Use @/server/ai/runtime.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/^(google|openai|anthropic|xai|meta|mistral|deepseek|alibaba|amazon|cohere|perplexity|moonshotai|zai)\\/[a-z0-9][a-z0-9.:-]*$/]",
          message:
            "No model ids in business code: name an AI process; models live in src/server/ai/processes.ts defaults and the DB.",
        },
      ],
    },
  },
  {
    files: ["src/server/ai/**/*.{ts,tsx}"],
    ignores: [
      "src/server/ai/gateways/**",
      "src/server/ai/catalog-sources/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ai",
              importNames: ["createGateway", "gateway"],
              message: "Gateway providers belong in src/server/ai/gateways only.",
            },
          ],
          patterns: [
            {
              group: ["@ai-sdk/*"],
              message:
                "Vendor / gateway packages belong in src/server/ai/gateways or catalog-sources only.",
            },
          ],
        },
      ],
    },
  },
  // Vendored shadcn / Vercel AI Elements components are installed via
  // registry CLIs and get overwritten on update. Fixing React Compiler
  // rule violations in-place would regress on the next `shadcn add` /
  // `ai-elements` upgrade — the Vercel team has reviewed these patterns
  // and considers them intentional (e.g. Rive state-machine input
  // mutation, module-cached motion components, sync-with-props ref
  // writes, streaming-error fallback ref reads). We silence the
  // compiler rules for these directories only.
  {
    files: [
      "src/components/ai-elements/**/*.{ts,tsx}",
      "src/components/ui/**/*.{ts,tsx}",
    ],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
      "@next/next/no-img-element": "off",
      "jsx-a11y/role-has-required-aria-props": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
