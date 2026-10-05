import { ArrowDown, ArrowUp, CornerUpLeft, ListOrdered, MoreHorizontal, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui";
import type { QueueItem } from "./messageQueue";
import type { useMessageQueue } from "./useMessageQueue";
import "./messageQueue.css";

type QueueController = Pick<ReturnType<typeof useMessageQueue>,
  "queue" | "error" | "editingId" | "resume" | "pause" | "move" | "remove" | "steer" | "unblock" | "recover" | "retryOriginal">;

export function MessageQueue({ controller, running, onEdit }: {
  controller: QueueController;
  running: boolean;
  onEdit: (item: QueueItem) => void;
}) {
  const { queue } = controller;
  if (!queue.items.length && !controller.error && !(queue.dispatch && queue.paused)) return null;

  return (
    <section className="agent-message-queue" aria-label="待发送消息">
      {queue.items.length > 0 && <div className="agent-message-queue-head">
        <div className="agent-message-queue-heading">
          <ListOrdered size={14} aria-hidden="true" />
          <span>{queue.items.length} 条排队消息</span>
          {queue.paused && <span className="agent-message-queue-paused">已暂停</span>}
        </div>
        <Button
          className="agent-queue-button agent-queue-control"
          type="button" variant="ghost" size="sm"
          onClick={() => void (queue.paused ? controller.resume() : controller.pause("已手动暂停"))}
        >
          {queue.paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
          {queue.paused ? "继续队列" : "暂停队列"}
        </Button>
      </div>}
      {controller.error && <p className="agent-message-queue-error" role="alert">{controller.error}</p>}
      {queue.dispatch && queue.paused && <Button className="agent-queue-button" type="button" variant="ghost" size="sm" onClick={() => void controller.recover()}>核实当前运行</Button>}
      <ol className="agent-message-queue-list">
        {queue.items.map((item, index) => {
          const editable = item.state === "queued" && !item.submissionKey;
          const stateLabel = { queued: item.mode === "steer" ? "准备插入" : null, submitting: "正在提交",
            waiting_insert: "等待插入", blocked: "需要处理", uncertain: "结果待核实" }[item.state];
          return (
            <li key={item.itemId} className={`agent-message-queue-item${controller.editingId === item.itemId ? " is-editing" : ""}`}>
              <div className="agent-message-queue-content">
                <span className="agent-message-queue-preview" title={item.request.content}>{item.request.content}</span>
                {Boolean(stateLabel || item.request.contexts?.length) && <small className="agent-message-queue-meta">
                  {stateLabel}
                  {item.request.contexts?.length ? `${stateLabel ? " · " : ""}${item.request.contexts.length} 份引用` : ""}
                </small>}
                {item.error && <small className="agent-message-queue-error" role="status">{item.error}</small>}
              </div>
              <div className="agent-message-queue-actions">
                {editable && <>
                  {running && <Button className="agent-queue-button agent-queue-steer" type="button" variant="ghost" size="sm" onClick={() => void controller.steer(item.itemId)}>
                    <CornerUpLeft size={14} aria-hidden="true" />插入
                  </Button>}
                  <Button className="agent-queue-button agent-queue-icon" type="button" variant="ghost" size="icon" aria-label={`编辑排队消息 ${index + 1}`} title="编辑消息" onClick={() => onEdit(item)}>
                    <Pencil size={14} aria-hidden="true" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="agent-queue-button agent-queue-icon" type="button" variant="ghost" size="icon" aria-label={`排队消息 ${index + 1} 的更多操作`} title="更多操作">
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent data-ui-theme="light" className="agent-queue-menu" align="end" sideOffset={5}>
                      <DropdownMenuItem className="agent-queue-menu-item" disabled={index === 0 || Boolean(queue.items[index - 1]?.submissionKey)} onSelect={() => void controller.move(item.itemId, -1)}>
                        <ArrowUp aria-hidden="true" />上移
                      </DropdownMenuItem>
                      <DropdownMenuItem className="agent-queue-menu-item" disabled={index === queue.items.length - 1 || Boolean(queue.items[index + 1]?.submissionKey)} onSelect={() => void controller.move(item.itemId, 1)}>
                        <ArrowDown aria-hidden="true" />下移
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="agent-queue-menu-separator" />
                      <DropdownMenuItem className="agent-queue-menu-item is-danger" onSelect={() => void controller.remove(item.itemId)}>
                        <Trash2 aria-hidden="true" />删除消息
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>}
                {item.state === "blocked" && item.retrySafe && <>
                  <Button className="agent-queue-button" type="button" variant="ghost" size="sm" onClick={() => void controller.unblock(item.itemId).then(() => onEdit(item))}>调整消息</Button>
                  <Button className="agent-queue-button agent-queue-icon" type="button" variant="ghost" size="icon" aria-label={`删除排队消息 ${index + 1}`} onClick={() => void controller.remove(item.itemId)}><Trash2 size={14} aria-hidden="true" /></Button>
                </>}
                {["uncertain", "waiting_insert"].includes(item.state) && <Button className="agent-queue-button" type="button" variant="ghost" size="sm" onClick={() => void controller.recover()}>核实状态</Button>}
                {item.state === "uncertain" && item.mode === "follow_up" && <Button className="agent-queue-button" type="button" variant="ghost" size="sm" onClick={() => void controller.retryOriginal(item.itemId)}>重试原提交</Button>}
              </div>
            </li>
          );
        })}
      </ol>
      {queue.paused && queue.pauseReason && !controller.editingId && <p className="agent-message-queue-reason">{queue.pauseReason}</p>}
    </section>
  );
}
