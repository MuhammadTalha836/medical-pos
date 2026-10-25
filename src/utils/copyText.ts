/** Copies text to the clipboard; false when the copy failed */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older engines: copy through a hidden text box
    const box = document.createElement('textarea');
    box.value = text;
    box.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  }
}
