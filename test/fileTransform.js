"use strict";

const path = require("path");

// This is a custom Jest transformer turning file imports into filenames.
// http://facebook.github.io/jest/docs/en/webpack.html

module.exports = {
    process(sourceText, sourcePath) {
        return {
            code: `module.exports = ${JSON.stringify(path.basename(sourcePath))};`,
        };
    },
};

// https://github.com/nolimits4web/swiper/discussions/4969#discussioncomment-1803613
