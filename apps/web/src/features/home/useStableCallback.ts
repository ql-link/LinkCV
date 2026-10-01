import { useCallback, useRef } from "react";

// 返回引用稳定的回调。v3 Dialog 的 effect 依赖 onClose，父组件每次渲染传入新函数会让焦点跳回弹窗第一个元素，
// 所以弹窗统一用它包一层再交给 Dialog。
export function useStableCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const ref = useRef(callback);
  ref.current = callback;
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
