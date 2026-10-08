// 模拟面试数据变化的通知：页面订阅后在数据层有变更时重新读取。
const listeners = new Set<() => void>();

export function subscribeMockInterviews(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyMockInterviews() {
  listeners.forEach((listener) => listener());
}
