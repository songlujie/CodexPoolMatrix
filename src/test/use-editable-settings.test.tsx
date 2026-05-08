import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditableSettings } from '@/hooks/use-editable-settings';

vi.mock('@/lib/api', () => ({
  api: {
    updateSettings: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import type { PoolSettings } from '@/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const baseSettings: PoolSettings = {
  strategy: 'round_robin',
  auto_rotation: true,
  rest_after_tasks: 0,
  cooldown_minutes: 5,
  rate_limit_buffer: 10,
  max_concurrent_tasks: 3,
  global_rate_limit: 100,
  auto_retry: true,
  max_retries: 2,
  task_timeout_minutes: 30,
  auto_dispatch: false,
  openclaw_endpoint: '',
  openclaw_api_key: '',
  codex_path: '',
  claude_path: '',
  mode: 'codex',
  current_codex_account_id: null,
  current_claude_account_id: null,
  auto_launch: false,
  auto_token_refresh: true,
  token_refresh_interval_hours: 72,
};

describe('useEditableSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.updateSettings).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the latest draft while saves are serialized', async () => {
    const firstSave = deferred<PoolSettings>();
    const secondSave = deferred<PoolSettings>();

    vi.mocked(api.updateSettings)
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    const { result } = renderHook(() => useEditableSettings({ sourceSettings: baseSettings }));

    act(() => {
      result.current.update({ global_rate_limit: 120 });
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.update({ global_rate_limit: 180 });
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.settings?.global_rate_limit).toBe(180);
    expect(result.current.saveStatus).toBe('pending');

    await act(async () => {
      firstSave.resolve({ ...baseSettings, global_rate_limit: 120 });
      await Promise.resolve();
    });

    expect(result.current.settings?.global_rate_limit).toBe(180);
    expect(api.updateSettings).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondSave.resolve({ ...baseSettings, global_rate_limit: 180 });
      await Promise.resolve();
    });

    expect(result.current.settings?.global_rate_limit).toBe(180);
    expect(result.current.saveStatus).toBe('saved');
  });

  it('does not let stale source settings overwrite a dirty draft', () => {
    const { result, rerender } = renderHook(
      ({ sourceSettings }) => useEditableSettings({ sourceSettings }),
      {
        initialProps: { sourceSettings: baseSettings },
      },
    );

    act(() => {
      result.current.update({ max_concurrent_tasks: 9 });
    });

    rerender({ sourceSettings: { ...baseSettings } });

    expect(result.current.settings?.max_concurrent_tasks).toBe(9);
    expect(result.current.saveStatus).toBe('pending');
  });
});
