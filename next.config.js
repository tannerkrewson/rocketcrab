const withPWA = require("next-pwa");
const { RocketcrabMode } = require("./dist/types/enums");

const IS_DEV = process.env.NODE_ENV === "development";
const DOMAIN = IS_DEV ? "localhost" : "rocketcrab.com";

module.exports = withPWA({
    pwa: {
        dest: "public",
    },
    i18n: {
        locales: [RocketcrabMode.MAIN, RocketcrabMode.KIDS],
        defaultLocale: RocketcrabMode.MAIN,
        localeDetection: false,
        domains: [
            {
                // rocketcrab.com
                domain: DOMAIN,
                defaultLocale: RocketcrabMode.MAIN,
            },
            {
                // kids.rocketcrab.com
                domain: "kids." + DOMAIN,
                defaultLocale: RocketcrabMode.KIDS,
            },
        ],
    },
});
