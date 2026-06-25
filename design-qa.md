# Design QA

final result: passed

Reference: user-provided screenshot of a split-pane Markdown resume editor.

Verified:
- Desktop split-pane layout matches the requested editor/preview structure.
- Header includes editable title, menu entries, and global action buttons.
- Left editor shows Markdown content, line numbers, syntax highlighting, and toolbar controls.
- Right preview renders a white A4 page on a gray workspace with compact resume typography.
- Custom `::: left` / `::: right` blocks render as aligned resume rows.
- Preview toolbar controls update state; source modal opens and shows rendered HTML.
- Print CSS hides application chrome and keeps the A4 resume content printable.

Notes:
- Smart one-page uses deterministic font, line-height, and margin compression in this version.
