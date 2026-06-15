'use client';

import { createContext, ReactNode, useContext } from 'react';
import { User } from '../api/client';
import { Alert } from './ui';

const CurrentUserContext = createContext<User | null>(null);

export function CurrentUserProvider({ user, children }: { user: User; children: ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): User {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUser must be used inside CurrentUserProvider');
  return user;
}

export function RoleGate({
  allowed,
  message,
  children,
}: {
  allowed: User['role'][];
  message: string;
  children: ReactNode;
}) {
  const user = useCurrentUser();
  return allowed.includes(user.role) ? children : <Alert>{message}</Alert>;
}
