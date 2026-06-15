module.exports = {
    overrides: [
        {
            exclude: /\/node_modules\//,
            presets: ['module:react-native-builder-bob/babel-preset'],
            plugins: [
                // Order matters: metadata runs first (it transforms parameter decorators
                // and reads type annotations before preset-typescript strips them), then
                // the legacy method/class decorators, then class properties.
                'babel-plugin-transform-typescript-metadata',
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
