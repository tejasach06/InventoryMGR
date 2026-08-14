import { apiRequest } from './core';
import type { SetupStatus, User, UserRole } from './types';

export const auth = {
  setupStatus: () => apiRequest<SetupStatus>('/auth/setup'),
  setupAdmin: (email: string, password: string) =>
    apiRequest<{ user: User }>('/auth/setup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string, remember = false) =>
    apiRequest<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, remember }) }),
  logout: () => apiRequest<null>('/auth/logout', { method: 'POST' }),
  me: () => apiRequest<User>('/auth/me'),

  listUsers: () => apiRequest<User[]>('/users'),
  createUser: (payload: { email: string; password: string; role: UserRole; is_active: boolean }) =>
    apiRequest<User>('/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: Partial<{ password: string; role: UserRole; is_active: boolean }>) =>
    apiRequest<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteUser: (id: string) => apiRequest<null>(`/users/${id}`, { method: 'DELETE' }),
};
