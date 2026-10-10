import { expect, it } from 'vitest';
import { parseBridgeCommand } from './bridge';
it('only permits explicit commands with decimal resume IDs', () => {
  expect(parseBridgeCommand({ command: 'SELECT_RESUME', resumeId: '42', api: '/api/admin' })).toEqual({ command: 'SELECT_RESUME', resumeId: '42' });
  expect(parseBridgeCommand({ command: 'SELECT_RESUME', resumeId: '../42' })).toBeNull();
  expect(parseBridgeCommand({ command: 'FILL', tabId: 1 })).toBeNull();
  expect(parseBridgeCommand(null)).toBeNull();
});
