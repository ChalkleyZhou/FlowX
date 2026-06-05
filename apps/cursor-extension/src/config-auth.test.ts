import { describe, expect, it, vi } from 'vitest';
import { signOutFromFlowX } from './config';

const vscodeMocks = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vscodeMocks.showInformationMessage,
  },
}));

describe('signOutFromFlowX', () => {
  it('removes the stored FlowX token', async () => {
    const context = {
      secrets: {
        delete: vi.fn(),
      },
    };

    await signOutFromFlowX(context as never);

    expect(context.secrets.delete).toHaveBeenCalledWith('flowx.apiToken');
    expect(vscodeMocks.showInformationMessage).toHaveBeenCalledWith('FlowX signed out.');
  });
});
