import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default [
    {
        files: ["**/*.ts"],
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parser: tsParser,
            ecmaVersion: 2018,
            sourceType: "module",
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
        },
    },
    prettierRecommended,
    {
        files: ["**/*.ts"],
        rules: {
            "prettier/prettier": ["error"],
            "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
        },
    },
];
