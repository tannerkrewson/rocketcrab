module.exports = {
    roots: ["<rootDir>"],
    testPathIgnorePatterns: ["<rootDir>[/\\\\](node_modules|.next)[/\\\\]"],
    testEnvironment: "jsdom",
    transformIgnorePatterns: ["/node_modules/(?!(swiper))"],
    transform: {
        "^.+\\.(ts|tsx|js|jsx|mjs)$": "babel-jest",
        "^.+\\.(css)$": "<rootDir>/test/fileTransform.js",
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
