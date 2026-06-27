import { RoleGate } from '../../../components/AuthContext';
import { SettingsPage } from '../../../routes/SettingsPage';

export default function SettingsRoute() {
  return (
    <RoleGate allowed={['admin']} message="You need an admin account to manage settings.">
      <SettingsPage />
    </RoleGate>
  );
}
