import { createContext, useContext } from 'react';
import type { useRuntimeShell } from '@/hooks/use-runtime-shell';

export type AppShellContextValue = ReturnType<typeof useRuntimeShell>;

export const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell() {
  const value = useContext(AppShellContext);
  if (!value) {
    throw new Error('useAppShell must be used within AppShellLayout');
  }

  return value;
}
