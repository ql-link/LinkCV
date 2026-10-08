function copyWithSelection(text: string): void {
  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const input = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
    ? activeElement
    : null;
  const inputSelection = input && input.selectionStart !== null && input.selectionEnd !== null
    ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection }
    : null;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : [];
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;";

  // Stay inside a modal's focus boundary instead of appending to its inert background.
  const container = activeElement?.closest("dialog, [role='dialog'], [role='alertdialog']") ?? document.body;
  container.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    // Remote HTTP pages cannot use the secure-context Clipboard API.
    if (typeof document.execCommand !== "function" || !document.execCommand("copy")) {
      throw new Error("Clipboard copy is unavailable");
    }
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    ranges.forEach((range) => selection?.addRange(range));
    if (input && inputSelection) {
      input.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);
    }
  }
}

export async function copyText(text: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // A permission denial or browser limitation can still allow selection-based copying.
    }
  }
  // With no native API, copy synchronously while the click still has user activation.
  copyWithSelection(text);
}
