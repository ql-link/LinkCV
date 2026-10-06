import { createHash } from "node:crypto";

import { BLOCK_TEXT_LIMIT } from "./instructions.js";
import { codedError, immutableCopy, isAborted } from "./util.js";

export function materializeProposalOperations(operations, scopedContext) {
  const targetsByBlockId = new Map();
  for (const candidate of [scopedContext?.target, ...(scopedContext?.blocks ?? []).map((item) => item?.target)]) {
    if (candidate?.block_id) targetsByBlockId.set(candidate.block_id, candidate);
  }
  return operations.map((operation) => {
    const target = targetsByBlockId.get(operation.block_id);
    if (!target?.expected_text_hash) {
      const error = new Error("PATCH_OUT_OF_SCOPE");
      error.code = "PATCH_OUT_OF_SCOPE";
      throw error;
    }
    return {
      op: operation.op,
      target,
      new_text: operation.new_text,
      expected_text_hash: target.expected_text_hash,
    };
  });
}

export function proposalCallKey(mode, target, operations, sourceIds = []) {
  const digest = createHash("sha256").update(JSON.stringify({
    mode,
    resume_id: target.resume_id,
    block_id: target.block_id,
    expected_text_hash: target.expected_text_hash,
    source_ids: [...sourceIds].sort(),
    operations: operations.map(({ op, new_text, target: operationTarget }) => ({
      op,
      new_text,
      block_id: operationTarget.block_id,
    })),
  })).digest("hex");
  return `proposal:${digest}`;
}

export function translationCallKey(target, params) {
  return `translation:${createHash("sha256").update(JSON.stringify({
    resume_id: target.resume_id,
    expected_text_hash: target.expected_text_hash,
    target_language: params.target_language,
    proposed_title: params.proposed_title,
    data: params.data,
    style: params.style,
  })).digest("hex")}`;
}

export async function retryIdempotentProposal(request, payload, signal) {
  try {
    return await request(payload);
  } catch (error) {
    if (signal?.aborted || (typeof error?.status === "number" && error.status < 500)) {
      throw error;
    }
    // The server may have committed before a transport/5xx response was lost.
    // Reuse the same call key so the second POST returns that proposal.
    return request(payload);
  }
}

export const MAX_EDIT_TARGETS = 20;
const EDIT_OPS = {
  polish_local: new Set(["replace_target_text", "delete_target"]),
  rewrite_entry_star: new Set(["replace_target_text", "delete_target"]),
  generate_from_materials: new Set(["insert_after_target"]),
};

// A deletion carries no text; normalize it so the model cannot trip the schema on it.
export function prepareEditPlanArguments(args) {
  if (!args || typeof args !== "object" || !Array.isArray(args.edits)) return args;
  return {
    ...args,
    edits: args.edits.map((edit) => (
      edit && typeof edit === "object" && edit.op === "delete_target" && edit.new_text == null
        ? { ...edit, new_text: "" }
        : edit
    )),
  };
}

function operationFor(edit, target) {
  return {
    op: edit.op,
    target,
    new_text: edit.op === "delete_target" ? "" : edit.new_text,
    expected_text_hash: target.expected_text_hash,
  };
}

function resolvedTarget(result) {
  if (result?.status === "resolved" && result.target) return result.target;
  throw codedError(result?.status === "ambiguous" ? "TARGET_AMBIGUOUS" : "TARGET_NOT_FOUND");
}

// Turn one planned edit into the concrete server-read blocks it refers to.
async function resolveEditTargets(client, resumeId, edit, blockTargets) {
  if (edit.block_id) {
    const block = blockTargets.get(edit.block_id);
    if (!block?.target?.expected_text_hash) throw codedError("PATCH_OUT_OF_SCOPE");
    // The model only saw the head of a long block; replacing it whole would drop the rest.
    if (edit.op === "replace_target_text" && block.text.length > BLOCK_TEXT_LIMIT) {
      throw codedError("TARGET_TOO_LONG_FOR_BLOCK_EDIT");
    }
    return [block.target];
  }
  if (!edit.quoted_text) throw codedError("TARGET_NOT_FOUND");
  if (edit.parent_quoted_text) {
    const parent = resolvedTarget(await client.resolveTarget({
      resume_id: resumeId, quoted_text: edit.parent_quoted_text, scope_hint: "target",
    }));
    const parentContext = await client.scopedContext({ target: parent, scope: edit.parent_scope ?? "entry" });
    const matches = (parentContext.blocks ?? []).filter(
      (item) => item?.content?.trim() === edit.quoted_text.trim() && item?.target,
    );
    if (matches.length === 0) throw codedError("TARGET_NOT_FOUND");
    if (edit.match !== "all" && matches.length !== 1) throw codedError("TARGET_AMBIGUOUS");
    return (edit.match === "all" ? matches : matches.slice(0, 1)).map((item) => item.target);
  }
  if (edit.match === "all") throw codedError("TARGET_PARENT_REQUIRED");
  return [resolvedTarget(await client.resolveTarget({
    resume_id: resumeId, quoted_text: edit.quoted_text, scope_hint: "target",
  }))];
}

function validateEdit(mode, edit, sourceIds) {
  if (!EDIT_OPS[mode]?.has(edit.op)) throw codedError("PATCH_OUT_OF_SCOPE");
  if (mode === "generate_from_materials" && !sourceIds.length) throw codedError("SOURCE_REQUIRED");
  if (edit.op !== "delete_target" && typeof edit.new_text !== "string") throw codedError("TASK_NEW_TEXT_REQUIRED");
  if (edit.op === "insert_after_target" && !edit.new_text.trim()) throw codedError("TASK_NEW_TEXT_REQUIRED");
}

// Runs a model-written edit plan: the runtime locates, validates and persists every
// proposal itself, so each edit succeeds or fails on its own with a stable code.
export async function executeResumeEditPlan({
  client,
  resumeId,
  context,
  mode,
  edits,
  sourceIds = [],
  summary,
  toolCallId,
  signal,
  onActivity = () => undefined,
  onProposal = () => undefined,
}) {
  if (!resumeId) throw codedError("TARGET_RESOLUTION_REQUIRED");
  const plan = immutableCopy(edits);
  const blockTargets = new Map((context?.blocks ?? [])
    .filter((item) => item?.target?.block_id)
    .map((item) => [item.target.block_id, { target: item.target, text: item.content ?? "" }]));
  const results = plan.map((_, index) => ({ edit: index + 1, status: "failed", proposal_ids: [] }));
  const resolved = [];
  let expanded = 0;

  for (const [index, edit] of plan.entries()) {
    const key = `${toolCallId}:edit:${index + 1}`;
    const prefix = `修改 ${index + 1}/${plan.length}`;
    try {
      validateEdit(mode, edit, sourceIds);
      onActivity({ callKey: key, label: `${prefix}：定位内容`, status: "running" });
      const targets = await resolveEditTargets(client, resumeId, edit, blockTargets);
      if (mode === "generate_from_materials" && targets.length !== 1) throw codedError("PATCH_OUT_OF_SCOPE");
      expanded += targets.length;
      if (expanded > MAX_EDIT_TARGETS) throw codedError("EDIT_PLAN_TARGET_LIMIT");
      resolved.push({ index, key, prefix, edit, targets });
    } catch (error) {
      if (isAborted(error, signal)) throw error;
      results[index].error_code = error?.code ?? "AGENT_TOOL_FAILED";
      onActivity({ callKey: key, label: `${prefix}：未完成`, status: "failed", errorCode: results[index].error_code });
    }
  }

  const create = async (items, targetsAndOps, proposalSummary, rationale) => {
    const main = targetsAndOps[0].target;
    const operations = targetsAndOps.map(({ edit, target }) => operationFor(edit, target));
    const diagnosis = await client.diagnose({ target: main, scope: "target", source_ids: sourceIds });
    const proposal = await retryIdempotentProposal(client.scopedProposal, {
      call_key: proposalCallKey(mode, main, operations, sourceIds),
      mode,
      target: main,
      diagnosis: diagnosis.diagnosis,
      diagnosis_fingerprint: diagnosis.diagnosis_fingerprint,
      operations,
      rationale,
      source_ids: sourceIds,
      summary: proposalSummary,
    }, signal);
    for (const item of items) {
      results[item.index].status = "succeeded";
      results[item.index].proposal_ids.push(proposal.proposal.id);
      delete results[item.index].error_code;
      onActivity({ callKey: item.key, label: `${item.prefix}：已生成待确认修改`, status: "succeeded" });
    }
    onProposal(proposal.proposal);
  };
  const fail = (items, error) => {
    if (isAborted(error, signal)) throw error;
    for (const item of items) {
      results[item.index].error_code = error?.code ?? "AGENT_TOOL_FAILED";
      onActivity({ callKey: item.key, label: `${item.prefix}：未完成`, status: "failed", errorCode: results[item.index].error_code });
    }
  };

  if (mode === "rewrite_entry_star") {
    // One proposal rewrites one entry; edits that reach outside it are refused together.
    const pairs = resolved.flatMap((item) => item.targets.map((target) => ({ edit: item.edit, target })));
    if (pairs.length) {
      const entries = new Set(pairs.map(({ target }) => target.entry_id));
      try {
        if (entries.size !== 1 || !pairs[0].target.entry_id) throw codedError("PATCH_OUT_OF_SCOPE");
        await create(resolved, pairs, summary, resolved.flatMap((item) => item.edit.rationale ?? []));
      } catch (error) {
        fail(resolved, error);
      }
    }
  } else {
    for (const item of resolved) {
      for (const [targetIndex, target] of item.targets.entries()) {
        const suffix = item.targets.length > 1 ? `（${targetIndex + 1}/${item.targets.length}）` : "";
        try {
          onActivity({ callKey: item.key, label: `${item.prefix}${suffix}：创建待确认修改`, status: "running" });
          await create([item], [{ edit: item.edit, target }],
            item.targets.length > 1 ? `${item.edit.summary}（${targetIndex + 1}/${item.targets.length}）` : item.edit.summary,
            item.edit.rationale ?? []);
        } catch (error) {
          fail([item], error);
          break;
        }
      }
    }
  }

  // A multi-target edit is only fully done when every proposal it expanded to exists.
  for (const item of resolved) {
    if (results[item.index].status === "succeeded" && results[item.index].proposal_ids.length < item.targets.length
        && mode !== "rewrite_entry_star") {
      results[item.index].status = results[item.index].proposal_ids.length ? "partial" : "failed";
      results[item.index].error_code ??= "AGENT_TOOL_FAILED";
    }
  }
  return Object.freeze(results.map((result) => Object.freeze(result)));
}
