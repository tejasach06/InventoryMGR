import { RoleGate } from '../../../components/AuthContext';
import { UsersPage } from '../../../routes/UsersPage';

export default function UsersRoute() {
  return (
    <RoleGate allowed={['admin']} message="You need an admin account to manage users.">
      <UsersPage />
    </RoleGate>
  );
}
