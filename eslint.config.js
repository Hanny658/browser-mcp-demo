import eslintPlugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    ignores: ["dist/**", "node_modules/**"],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": eslintPlugin
    },
    rules: {
      ...eslintPlugin.configs.recommended.rules
    }
  },
  {
    files: ["demo_frontend/src/**/*.{ts,tsx}"],
    ignores: ["demo_frontend/node_modules/**", "demo_frontend/dist/**"],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      "@typescript-eslint": eslintPlugin
    },
    rules: {
      ...eslintPlugin.configs.recommended.rules
    }
  }
];
