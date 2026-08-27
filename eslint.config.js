import globals from "globals";

export default [
  {
    ignores: ["dist/**", "artifacts/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.js", "scripts/**/*.mjs", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        browser: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-global-assign": "error",
      "no-implicit-globals": "error",
      "eqeqeq": "error",
    },
  },
];
