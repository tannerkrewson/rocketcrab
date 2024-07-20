module.exports = {
    roots: ["<rootDir>"],
    moduleFileExtensions: ["js", "ts", "tsx", "json"],
    testPathIgnorePatterns: ["<rootDir>[/\\\\](node_modules|.next)[/\\\\]"],
    testEnvironment: "jsdom",
    transformIgnorePatterns: ["[/\\\\]node_modules[/\\\\].+\\.(ts|tsx)$"],
    transform: {
        "^.+\\.(ts|tsx)$": "babel-jest",
    },
    watchPlugins: [
        "jest-watch-typeahead/filename",
        "jest-watch-typeahead/testname",
    ],
    moduleNameMapper: {
        "@aw-web-design/react-textfit":
            "<rootDir>/node_modules/@aw-web-design/react-textfit/dist/index.js",
        "\\.(css|less|sass|scss)$": "identity-obj-proxy",
        "\\.(gif|ttf|eot|svg|png)$": "<rootDir>/test/__mocks__/fileMock.js",
    },
};
