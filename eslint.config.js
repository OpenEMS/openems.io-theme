import js from '@eslint/js'
import globals from 'globals'

export default [
    js.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.es2021,
                ...globals.node,
            },
        },
        rules: {
            "no-unused-vars": "off",
            "arrow-parens": ["error", "always"],
            "comma-dangle": ["error",
                {
                    arrays: "always-multiline",
                    objects: "always-multiline",
                    imports: "always-multiline",
                    exports: "always-multiline",
                },
            ],
            "no-restricted-properties": [
                "error",
                {
                    property: "substr",
                    message: "Use String #slice instead",
                },
            ],
            "max-len": ["warn", 128, 2],
            "spaced-comment": "off",
            "radix": ["error", "always"],
        },
    },
];