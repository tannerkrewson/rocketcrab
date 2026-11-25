/**
 * Clipboard writes fall back to a hidden textarea when the asynchronous
 * API is unavailable or denied. Reads have no synchronous fallback; callers
 * surface permission errors.
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
