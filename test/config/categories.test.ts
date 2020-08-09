import { getClientGameLibrary } from "../../config";

describe("config", () => {
    it("all games have valid categories", () => {
        const { categories, gameList } = getClientGameLibrary();
        gameList.forEach(({ category }) =>
            category.forEach((gameCatId) =>
                expect(
                    categories.find(({ id }) => id === gameCatId)
                ).toBeTruthy()
            )
        );
    });
});
