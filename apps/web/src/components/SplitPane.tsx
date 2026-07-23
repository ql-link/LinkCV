import { ReactNode, useCallback, useRef } from "react";
import { useResumeStore } from "../store/resumeStore";

type SplitPaneProps = {
  left: ReactNode;
  right: ReactNode;
};

export function SplitPane({ left, right }: SplitPaneProps) {
  const ratio = useResumeStore((state) => state.splitRatio);
  const setSplitRatio = useResumeStore((state) => state.setSplitRatio);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;

      event.currentTarget.setPointerCapture(event.pointerId);

      const update = (clientX: number) => {
        const rect = container.getBoundingClientRect();
        const nextRatio = (clientX - rect.left) / rect.width;
        setSplitRatio(Math.min(0.68, Math.max(0.28, nextRatio)));
      };

      const onMove = (moveEvent: PointerEvent) => update(moveEvent.clientX);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      update(event.clientX);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setSplitRatio],
  );

  return (
    <main className="split-pane" ref={containerRef}>
      <section className="pane editor-pane" style={{ flexBasis: `${ratio * 100}%` }}>
        {left}
      </section>
      <div
        className="splitter"
        role="separator"
        aria-label="调整编辑区和预览区宽度"
        tabIndex={0}
        onPointerDown={startDrag}
      />
      <section className="pane preview-pane">{right}</section>
    </main>
  );
}
