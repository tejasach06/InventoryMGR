import type { UserRole } from '../api/types';

export function canEditInventory(role: UserRole): boolean {
  return role === 'editor' || role === 'admin';
}
