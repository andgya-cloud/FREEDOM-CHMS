import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { DEFAULT_PIPELINE, type PipelineStage } from '../../functions/src/shared/people';

function useSettingsDoc<T>(id: string, fallback: T): T {
  const { profile } = useAuth();
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    if (!profile?.active) return;
    return onSnapshot(doc(db, 'settings', id), (snap) => {
      if (snap.exists()) setValue({ ...fallback, ...(snap.data() as Partial<T>) });
    }, () => undefined);
    // fallback is a constant per call site
  }, [profile?.active, id]);
  return value;
}

export interface PipelineSettings {
  stages: PipelineStage[];
  sensitiveStageIds: string[];
}

const PIPELINE_FALLBACK: PipelineSettings = { stages: DEFAULT_PIPELINE, sensitiveStageIds: ['salvation', 'baptism'] };

export function usePipelineSettings(): PipelineSettings {
  return useSettingsDoc('pipeline', PIPELINE_FALLBACK);
}

export const CUSTOM_FIELD_TYPES = ['text', 'date', 'yesno', 'choice'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  active: boolean;
}

const CUSTOM_FIELDS_FALLBACK: { fields: CustomField[] } = { fields: [] };

export function useCustomFields(): CustomField[] {
  return useSettingsDoc('customFields', CUSTOM_FIELDS_FALLBACK).fields;
}
