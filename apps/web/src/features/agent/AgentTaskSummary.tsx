import type { AgentMessage } from "../../api/client";

export function AgentTaskSummary({ tasks }: { tasks: AgentMessage["tasks"] }) {
  if (!tasks?.length) return null;
  const labels = { planned: "待执行", running: "进行中", completed: "已完成", partial: "部分完成", blocked: "待处理", failed: "未完成" };
  return <ul className="agent-task-summary" aria-label="本条消息的任务">
    {tasks.map((task) => <li key={task.id}><span>{task.label}</span><small>{task.superseded_by_sequence_no
      ? "已由后续指令调整" : labels[task.status]}</small></li>)}
  </ul>;
}
