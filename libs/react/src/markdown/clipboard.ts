/** Writes text to the clipboard, falling back to a selection copy where the async API is absent or refuses. */
export async function writeClipboard(document: Document, text: string): Promise<boolean> {
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permissions, an insecure context or an unfocused document: try the selection copy.
    }
  }
  // Selecting the helper takes focus; hand it back so a keyboard user stays on the button.
  const focused = document.activeElement;
  const area = document.createElement('textarea');
  try {
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    return document.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    area.remove();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
  }
}
