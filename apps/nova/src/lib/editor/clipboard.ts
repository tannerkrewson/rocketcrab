/**
 * Clipboard helpers for the editor (U4: paste from clipboard, copy
 * diagnostic report). `navigator.clipboard` is unavailable on some Safari
 * versions and in insecure contexts, so writes fall back to a hidden
 * textarea + execCommand. Reads have no synchronous fallback; callers
 * surface the permission error instead of failing silently.
 */

/** Write text to the clipboard; resolves true on success. */
export async function writeToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback.
    }
  }
  return copyViaTextarea(text);
}

/** Read text from the clipboard; rejects when unavailable or denied. */
export async function readFromClipboard(): Promise<string> {
  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard reading is not available in this browser.");
  }
  return navigator.clipboard.readText();
}

function copyViaTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}
