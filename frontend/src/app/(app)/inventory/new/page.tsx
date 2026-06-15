import { RoleGate } from '../../../../components/AuthContext';
import { VmFormPage } from '../../../../routes/VmFormPage';

export default function NewVmRoute() {
  return (
    <RoleGate allowed={['admin', 'editor']} message="You need an editor or admin account to change VM inventory.">
      <VmFormPage mode="create" />
    </RoleGate>
  );
}
