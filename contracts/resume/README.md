# Resume contracts

These Draft 2020-12 schemas are the only shared v1 contracts for resume content,
source evidence, sparse model annotations, templates, presentation settings and
derived layout plans. Persisted canonical content must never contain template or
layout nodes.

Canonical bytes and hashes are produced only by the Python backend implementation
in `apps/backend/src/linkcv/domain/resume/canonical_json.py`: UTF-8 JSON after
recursive NFC validation, sorted object keys, compact separators, and no NaN or
Infinity. Hashes are lowercase SHA-256 hex. TypeScript consumers treat hashes as
opaque server values and must not implement a second canonicalizer.

SourceGraph bounding boxes use page-normalized coordinates in the range `0..1`.
Canonical content keeps user-authored inline style overrides and safe media
references, while template defaults remain in TemplateDefinition/Presentation.
Imported documents include a closed source disposition manifest.

Run `npm run check:contracts` after changing a schema or fixture.
