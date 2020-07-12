import fs from "fs";

export default () => {
    const gameList = [];
    fs.readdirSync(__dirname).forEach((file) => {
        if (file.startsWith("index.")) return;
        const name = file.substr(0, file.indexOf("."));
        gameList.push(require("./" + name).default);
    });
    return gameList;
};
