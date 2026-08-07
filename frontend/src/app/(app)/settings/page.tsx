import { RoleGate } from '../../../components/AuthContext';
import { SettingsPage } from '../../../routes/SettingsPage';

export default function SettingsRoute() {
  return (
    <RoleGate allowed={['admin', 'editor', 'viewer']} message="You need an account to manage preferences.">
      <SettingsPage />
    </RoleGate>
  );
}
