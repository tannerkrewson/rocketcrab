/** Load a game into the editor the way a user does: type it in, then Run. */
import { expect, type Page } from "@playwright/test";

export async function openEditorWithSource(page: Page, source: string): Promise<void> {
  await page.goto("/editor");
  const editor = page.getByRole("textbox", { name: "Game HTML source" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.fill(source);
  await page.getByRole("button", { name: "Run", exact: true }).click();
}
