module.exports = {
    overrides: [
        {
            exclude: /\/node_modules\//,
            presets: ['module:react-native-builder-bob/babel-preset'],
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
