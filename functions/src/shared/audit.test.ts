import { describe, expect, it } from 'vitest';
import { changedFields, classifyWrite } from './audit';

describe('audit classification', () => {
  it('classifies create, update, delete, restore and purge', () => {
    expect(classifyWrite(undefined, { name: 'A' })).toBe('create');
    expect(classifyWrite({ name: 'A' }, { name: 'B' })).toBe('update');
    expect(classifyWrite({ deletedAt: null }, { deletedAt: 123 })).toBe('delete');
    expect(classifyWrite({ deletedAt: 123 }, { deletedAt: null })).toBe('restore');
    expect(classifyWrite({ name: 'A' }, undefined)).toBe('purge');
  });

  it('lists changed field names but ignores the stamps', () => {
    expect(changedFields({ name: 'A', phone: '1', updatedAt: 1 }, { name: 'B', phone: '1', updatedAt: 2 })).toEqual(['name']);
  });
});
