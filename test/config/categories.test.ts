import { getClientGameLibrary } from "../../config";
import { RocketcrabMode } from "../../types/enums";

describe("config", () => {
    it("all games have valid categories", () => {
        const { categories, gameList } = getClientGameLibrary(
            RocketcrabMode.ALL
        );
        gameList.forEach(({ category }) =>
            category.forEach((gameCatId) =>
                expect(
                    categories.find(({ id }) => id === gameCatId)
                ).toBeTruthy()
            )
        );
    });
});
