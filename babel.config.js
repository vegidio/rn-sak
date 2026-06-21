module.exports = (api) => {
    // bob's "module" build sets `supportsStaticESM` on the Babel caller — keep native
    // ESM (`import`/`export`) in that output. Jest (CommonJS) leaves it false, so the
    // import/export statements are downleveled to `require` for the test environment.
    const supportsStaticESM = api.caller((caller) => Boolean(caller && caller.supportsStaticESM));
    api.cache.using(() => supportsStaticESM);

    return {
        overrides: [
            {
                exclude: /\/node_modules\//,
                presets: [['module:@react-native/babel-preset', {disableImportExportTransform: supportsStaticESM}]],
                plugins: [
                    // Legacy method/class decorators (`@Get`/`@Post`/...), then class properties.
                    // Order matters: decorators before class properties.
                    ['@babel/plugin-proposal-decorators', {version: 'legacy'}],
                    ['@babel/plugin-transform-class-properties', {loose: true}],
                ],
            },
            {
                include: /\/node_modules\//,
                presets: ['module:@react-native/babel-preset'],
            },
        ],
    };
};
