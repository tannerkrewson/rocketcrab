/** Load a game into the editor the way a user does: type it in the Code tab, then Run. */
import { expect, type Page } from "@playwright/test";

export async function openEditorWithSource(page: Page, source: string): Promise<void> {
  // Skip the first-visit tutorial modal, which would cover the editor.
  await page.addInitScript(() => {
    localStorage.setItem("nova:editor-tutorial-dismissed:v1", "1");
  });
  await page.goto("/editor");
  // The editor opens on the Test tab; the code editor is the Code tab.
  await page.getByRole("tab", { name: "Code" }).click();
  const editor = page.getByRole("textbox", { name: "Game HTML source" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.fill(source);
  await page.getByRole("button", { name: "Run", exact: true }).click();
}
