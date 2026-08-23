import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { diffWordsWithSpace } from "diff";

export type InlineAiSuggestion = {
  from: number;
  to: number;
  original: string;
  replacement: string | null;
  stale: boolean;
};

type InlineAiMeta =
  | { type: "set"; suggestion: Omit<InlineAiSuggestion, "stale"> }
  | { type: "clear" };

export const inlineAiSuggestionKey = new PluginKey<InlineAiSuggestion | null>("resumeInlineAiSuggestion");

function selectedText(editor: Editor, from: number, to: number) {
  return editor.state.doc.textBetween(from, to, "", "\ufffc");
}

export function canStartInlineAiEdit(editor: Editor) {
  const { from, to, empty, $from, $to } = editor.state.selection;
  return !empty
    && $from.parent === $to.parent
    && $from.parent.isTextblock
    && selectedText(editor, from, to).trim().length > 0;
}

export function setInlineAiSuggestion(
  editor: Editor,
  suggestion: Omit<InlineAiSuggestion, "stale">,
) {
  editor.view.dispatch(editor.state.tr.setMeta(inlineAiSuggestionKey, { type: "set", suggestion } satisfies InlineAiMeta));
}

export function clearInlineAiSuggestion(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(inlineAiSuggestionKey, { type: "clear" } satisfies InlineAiMeta));
}

export function getInlineAiSuggestion(editor: Editor) {
  return inlineAiSuggestionKey.getState(editor.state) ?? null;
}

export function applyInlineAiSuggestion(editor: Editor) {
  const suggestion = getInlineAiSuggestion(editor);
  if (!suggestion?.replacement || suggestion.stale) return false;
  const current = selectedText(editor, suggestion.from, suggestion.to);
  if (current !== suggestion.original) return false;

  const marks = editor.state.doc.resolve(suggestion.from).marks();
  const replacement = editor.state.schema.text(suggestion.replacement, marks);
  const transaction = editor.state.tr
    .setMeta(inlineAiSuggestionKey, { type: "clear" } satisfies InlineAiMeta)
    .replaceWith(suggestion.from, suggestion.to, replacement);
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(
    transaction.doc.content.size,
    suggestion.from + suggestion.replacement.length,
  ))));
  editor.view.dispatch(transaction);
  return true;
}

function diffWidget(suggestion: InlineAiSuggestion) {
  return Decoration.widget(suggestion.from, () => {
    const wrapper = document.createElement("span");
    wrapper.className = "resume-ai-inline-diff";
    wrapper.contentEditable = "false";
    for (const part of diffWordsWithSpace(suggestion.original, suggestion.replacement ?? "")) {
      const span = document.createElement("span");
      span.className = part.added
        ? "resume-ai-diff-added"
        : part.removed
          ? "resume-ai-diff-removed"
          : "resume-ai-diff-equal";
      span.textContent = part.value;
      wrapper.append(span);
    }
    return wrapper;
  }, {
    key: `resume-ai-diff-${suggestion.from}-${suggestion.to}-${suggestion.replacement}`,
    side: -1,
  });
}

function suggestionDecorations(suggestion: InlineAiSuggestion | null, doc: Parameters<typeof DecorationSet.create>[0]) {
  if (!suggestion) return DecorationSet.empty;
  if (suggestion.stale) {
    return DecorationSet.create(doc, [
      Decoration.inline(suggestion.from, suggestion.to, { class: "resume-ai-selection is-stale" }),
    ]);
  }
  if (!suggestion.replacement) {
    return DecorationSet.create(doc, [
      Decoration.inline(suggestion.from, suggestion.to, { class: "resume-ai-selection" }),
    ]);
  }
  return DecorationSet.create(doc, [
    Decoration.inline(suggestion.from, suggestion.to, { class: "resume-ai-source-hidden" }),
    diffWidget(suggestion),
  ]);
}

export const InlineAiSuggestionExtension = Extension.create({
  name: "resumeInlineAiSuggestion",
  addProseMirrorPlugins() {
    return [new Plugin<InlineAiSuggestion | null>({
      key: inlineAiSuggestionKey,
      state: {
        init: () => null,
        apply(transaction, previous, _oldState, nextState) {
          const meta = transaction.getMeta(inlineAiSuggestionKey) as InlineAiMeta | undefined;
          if (meta?.type === "clear") return null;
          if (meta?.type === "set") return { ...meta.suggestion, stale: false };
          if (!previous || !transaction.docChanged) return previous;
          const from = transaction.mapping.map(previous.from, -1);
          const to = transaction.mapping.map(previous.to, 1);
          const current = nextState.doc.textBetween(from, to, "", "\ufffc");
          return { ...previous, from, to, stale: current !== previous.original };
        },
      },
      props: {
        decorations(state) {
          return suggestionDecorations(inlineAiSuggestionKey.getState(state) ?? null, state.doc);
        },
      },
    })];
  },
});
