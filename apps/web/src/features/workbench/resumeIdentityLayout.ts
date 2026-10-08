import type { JSONContent } from "@tiptap/core";
import type { CanonicalResumeDocument } from "../../api/resumeContract";

export const identityHeadlineClass = "resume-identity-headline";
export const identityContactsClass = "resume-identity-contacts";

/** Identity placement follows canonical anchors, even when optional lines are absent. */
export function resumeIdentityParagraphClass(node: JSONContent) {
  if (node.type !== "paragraph") return null;
  const roles = (node.content ?? [])
    .filter((child) => child.type === "resumeBlockAnchor")
    .map((child) => child.attrs?.role);
  if (roles.includes("contact")) return identityContactsClass;
  if (roles.includes("identity-headline")) return identityHeadlineClass;
  return null;
}

/** Only a template switch resets identity alignment; ordinary edits keep it. */
export function resetResumeIdentityAlignment(document: CanonicalResumeDocument): CanonicalResumeDocument {
  const { identity } = document;
  return {
    ...document,
    identity: {
      ...identity,
      name: identity.name ? { ...identity.name, align: null } : null,
      headline: identity.headline ? { ...identity.headline, align: null } : null,
      contacts: identity.contacts.map((contact) => ({ ...contact, align: null })),
    },
  };
}

export function resetEditorIdentityAlignment(node: JSONContent): JSONContent {
  const isIdentityName = node.type === "heading" && Number(node.attrs?.level) === 1
    && (node.content ?? []).some((child) => child.type === "resumeBlockAnchor"
      && (child.attrs?.role === "identity" || child.attrs?.role === "identity-name"));
  const isIdentity = resumeIdentityParagraphClass(node)
    || isIdentityName;
  return {
    ...node,
    ...(isIdentity && node.attrs?.textAlign ? { attrs: { ...node.attrs, textAlign: null } } : {}),
    ...(node.content ? { content: node.content.map(resetEditorIdentityAlignment) } : {}),
  };
}
