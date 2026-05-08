import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { PoolSettings } from '@/types';

export type SettingsSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface UseEditableSettingsOptions {
  sourceSettings: PoolSettings | null | undefined;
  debounceMs?: number;
  onSaveError?: (error: unknown) => void;
  onAfterSave?: (settings: PoolSettings) => Promise<void> | void;
}

function settingsSnapshot(settings: PoolSettings | null | undefined) {
  return settings ? JSON.stringify(settings) : '';
}

export function useEditableSettings({
  sourceSettings,
  debounceMs = 300,
  onSaveError,
  onAfterSave,
}: UseEditableSettingsOptions) {
  const [settings, setSettings] = useState<PoolSettings | null>(sourceSettings ?? null);
  const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const settingsRef = useRef<PoolSettings | null>(sourceSettings ?? null);
  const lastSavedAtRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedSnapshotRef = useRef(settingsSnapshot(sourceSettings));
  const queuedSettingsRef = useRef<PoolSettings | null>(null);
  const isSavingRef = useRef(false);

  const updateDraft = useCallback((nextSettings: PoolSettings) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }, []);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const runSave = useCallback(async (nextSettings: PoolSettings) => {
    if (isSavingRef.current) {
      queuedSettingsRef.current = nextSettings;
      setSaveStatus('pending');
      return false;
    }

    isSavingRef.current = true;
    setSaveStatus('saving');

    const requestSnapshot = settingsSnapshot(nextSettings);

    try {
      const savedSettings = await api.updateSettings(nextSettings);
      lastSyncedSnapshotRef.current = settingsSnapshot(savedSettings);
      lastSavedAtRef.current = Date.now();
      setLastSavedAt(lastSavedAtRef.current);

      if (settingsSnapshot(settingsRef.current) === requestSnapshot) {
        updateDraft(savedSettings);
      }

      if (settingsSnapshot(settingsRef.current) === lastSyncedSnapshotRef.current) {
        setSaveStatus('saved');
      } else {
        setSaveStatus('pending');
      }

      await onAfterSave?.(savedSettings);
      return true;
    } catch (error) {
      setSaveStatus('error');
      onSaveError?.(error);
      return false;
    } finally {
      isSavingRef.current = false;

      const queuedSettings = queuedSettingsRef.current;
      queuedSettingsRef.current = null;

      if (queuedSettings && settingsSnapshot(queuedSettings) !== lastSyncedSnapshotRef.current) {
        void runSave(queuedSettings);
      }
    }
  }, [onAfterSave, onSaveError, updateDraft]);

  const scheduleSave = useCallback((nextSettings: PoolSettings) => {
    clearSaveTimer();
    saveTimerRef.current = setTimeout(() => {
      void runSave(nextSettings);
    }, debounceMs);
  }, [clearSaveTimer, debounceMs, runSave]);

  const applyDraft = useCallback((nextSettings: PoolSettings, options?: { scheduleSave?: boolean }) => {
    updateDraft(nextSettings);

    if (settingsSnapshot(nextSettings) === lastSyncedSnapshotRef.current) {
      clearSaveTimer();
      if (!isSavingRef.current) {
        setSaveStatus(lastSavedAtRef.current ? 'saved' : 'idle');
      }
      return;
    }

    setSaveStatus('pending');

    if (options?.scheduleSave !== false) {
      scheduleSave(nextSettings);
    }
  }, [clearSaveTimer, scheduleSave, updateDraft]);

  const update = useCallback((partial: Partial<PoolSettings>) => {
    if (!settingsRef.current) return;
    applyDraft({ ...settingsRef.current, ...partial });
  }, [applyDraft]);

  const replaceSettings = useCallback((nextSettings: PoolSettings, options?: { scheduleSave?: boolean }) => {
    applyDraft(nextSettings, options);
  }, [applyDraft]);

  const saveNow = useCallback(async (nextSettings?: PoolSettings) => {
    const targetSettings = nextSettings ?? settingsRef.current;
    if (!targetSettings) return false;

    clearSaveTimer();

    if (nextSettings) {
      updateDraft(nextSettings);
    }

    return runSave(targetSettings);
  }, [clearSaveTimer, runSave, updateDraft]);

  useEffect(() => {
    if (!sourceSettings) {
      return;
    }

    const sourceSnapshot = settingsSnapshot(sourceSettings);
    const currentSnapshot = settingsSnapshot(settingsRef.current);
    const hasDirtyDraft = Boolean(settingsRef.current) && currentSnapshot !== lastSyncedSnapshotRef.current;

    if (hasDirtyDraft && sourceSnapshot === lastSyncedSnapshotRef.current) {
      return;
    }

    lastSyncedSnapshotRef.current = sourceSnapshot;
    updateDraft(sourceSettings);

    if (!hasDirtyDraft && !isSavingRef.current) {
      setSaveStatus(lastSavedAtRef.current ? 'saved' : 'idle');
    }
  }, [sourceSettings, updateDraft]);

  useEffect(() => () => {
    clearSaveTimer();
  }, [clearSaveTimer]);

  return {
    settings,
    saveStatus,
    lastSavedAt,
    hasUnsavedChanges: settingsSnapshot(settingsRef.current) !== lastSyncedSnapshotRef.current,
    update,
    replaceSettings,
    saveNow,
  };
}
