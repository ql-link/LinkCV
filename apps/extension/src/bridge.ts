export type BridgeCommand = { command: 'PING' } | { command: 'AUTH_CHANGED' } | { command: 'SELECT_RESUME'; resumeId: string };
export function parseBridgeCommand(value: unknown): BridgeCommand | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.command === 'PING' || message.command === 'AUTH_CHANGED') return { command: message.command };
  if (message.command === 'SELECT_RESUME' && typeof message.resumeId === 'string' && /^[1-9]\d{0,19}$/.test(message.resumeId)) {
    return { command: message.command, resumeId: message.resumeId };
  }
  return null;
}
