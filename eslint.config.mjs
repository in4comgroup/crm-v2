import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ── Layer boundaries ───────────────────────────────────────────────────
// AI layer:       docs/specs/models/01-gateway-providers.md §3
// Object storage: docs/specs/s3-r2/01-architecture.md §3
// DB access:      AGENTS.md "Working rules → 5. Database access" — only
//                 src/server/** (+ src/db/**, the better-auth adapter in
//                 src/lib/auth.ts) may import a DB value; `import type` is
//                 allowed everywhere.
//
// ESLint flat config: a later block that sets the SAME rule replaces the
// earlier one for the files it matches. So every scope below gets the FULL
// set of restrictions that apply to it, built from these parts — never add
// a separate block with its own no-restricted-imports / no-restricted-syntax
// for src/**, it would silently switch the others off.

const AI_CALLS = {
  name: "ai",
  importNames: ["generateText", "streamText", "generateObject", "streamObject", "createGateway", "gateway"],
  message: "Call models through aiGenerateText / aiStreamText from @/server/ai/runtime with a process key.",
};
const AI_GATEWAY_FACTORY = {
  name: "ai",
  importNames: ["createGateway", "gateway"],
  message: "Gateway providers belong in src/server/ai/gateways only.",
};
const AI_VENDOR_PACKAGES = {
  group: ["@ai-sdk/*", "!@ai-sdk/react"],
  message: "Vendor / gateway packages belong in src/server/ai/gateways only. Use @/server/ai/runtime.",
};
const AI_VENDOR_PACKAGES_CORE = {
  group: ["@ai-sdk/*"],
  message: "Vendor / gateway packages belong in src/server/ai/gateways or catalog-sources only.",
};
const STORAGE_SDK = {
  group: ["@aws-sdk/*"],
  message: "Object storage goes through @/server/storage (AWS SDK only in src/server/storage/s3).",
};
const DB_ACCESS = {
  group: ["@/db/*", "**/db/drizzle", "**/db/schema", "drizzle-orm", "drizzle-orm/*", "@neondatabase/*"],
  allowTypeImports: true,
  message:
    "No DB access outside src/server: put the query in a src/server module (import \"server-only\") and call it. `import type` is fine.",
};
const MODEL_ID_LITERAL = {
  selector:
    "Literal[value=/^(google|openai|anthropic|xai|meta|mistral|deepseek|alibaba|amazon|cohere|perplexity|moonshotai|zai)\\/[a-z0-9][a-z0-9.:-]*$/]",
  message:
    "No model ids in business code: name an AI process; models live in src/server/ai/processes.ts defaults and the DB.",
};
const STORAGE_ENV = {
  selector:
    "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^(R2|STORAGE)_/]",
  message: "Storage env vars are read only by src/server/storage/providers/*.",
};

// The typescript-eslint version of no-restricted-imports (same options +
// `allowTypeImports`). The core rule stays off so the two never stack.
const restrict = ({ paths = [], patterns = [], syntax = [] }) => ({
  "no-restricted-imports": "off",
  ...(paths.length || patterns.length
    ? { "@typescript-eslint/no-restricted-imports": ["error", { paths, patterns }] }
    : { "@typescript-eslint/no-restricted-imports": "off" }),
  ...(syntax.length ? { "no-restricted-syntax": ["error", ...syntax] } : { "no-restricted-syntax": "off" }),
});

const AI_CORE = "src/server/ai/**/*.{ts,tsx}";
const AI_VENDOR = ["src/server/ai/gateways/**/*.{ts,tsx}", "src/server/ai/catalog-sources/**/*.{ts,tsx}"];
const STORAGE_CORE = "src/server/storage/s3/**/*.{ts,tsx}";
const STORAGE_PROVIDERS = "src/server/storage/providers/**/*.{ts,tsx}";

// The only places that may touch the DB.
const DB_LAYER = ["src/server/**/*.{ts,tsx}", "src/db/**/*.{ts,tsx}", "src/lib/auth.ts"];

const layerBoundaries = [
  // Everything else (routes, pages, layouts, components, hooks, lib,
  // workflows, proxy): all restrictions, incl. no DB access.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: restrict({
      paths: [AI_CALLS],
      patterns: [AI_VENDOR_PACKAGES, STORAGE_SDK, DB_ACCESS],
      syntax: [MODEL_ID_LITERAL, STORAGE_ENV],
    }),
  },
  // Server modules + the DB client + the better-auth adapter: same, but DB
  // access allowed. The blocks below are narrower parts of src/server.
  {
    files: DB_LAYER,
    rules: restrict({
      paths: [AI_CALLS],
      patterns: [AI_VENDOR_PACKAGES, STORAGE_SDK],
      syntax: [MODEL_ID_LITERAL, STORAGE_ENV],
    }),
  },
  // AI core: may call the SDK and hold the process defaults (model ids).
  {
    files: [AI_CORE],
    rules: restrict({
      paths: [AI_GATEWAY_FACTORY],
      patterns: [AI_VENDOR_PACKAGES_CORE, STORAGE_SDK],
      syntax: [STORAGE_ENV],
    }),
  },
  // AI gateway adapters + catalog sources: the only vendor code of the AI layer.
  {
    files: AI_VENDOR,
    rules: restrict({ patterns: [STORAGE_SDK], syntax: [STORAGE_ENV] }),
  },
  // Storage S3 core: the only AWS SDK importer.
  {
    files: [STORAGE_CORE],
    rules: restrict({
      paths: [AI_CALLS],
      patterns: [AI_VENDOR_PACKAGES],
      syntax: [MODEL_ID_LITERAL, STORAGE_ENV],
    }),
  },
  // Storage providers: the only readers of storage env vars.
  {
    files: [STORAGE_PROVIDERS],
    rules: restrict({
      paths: [AI_CALLS],
      patterns: [AI_VENDOR_PACKAGES, STORAGE_SDK],
      syntax: [MODEL_ID_LITERAL],
    }),
  },
];

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
  ...layerBoundaries,
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
