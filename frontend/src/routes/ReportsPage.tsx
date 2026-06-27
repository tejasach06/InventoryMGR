'use client';

import { api } from '../api/client';
import { PageHeader, PageTransition } from '../components/ui';

const REPORTS = [
  { name: 'linux', label: 'Linux Inventory', description: 'All Linux VMs' },
  { name: 'windows', label: 'Windows Inventory', description: 'All Windows VMs' },
  { name: 'production', label: 'Production Inventory', description: 'All production environment VMs' },
  { name: 'monitoring', label: 'Monitoring Status', description: 'All VMs with monitoring status' },
  { name: 'applications', label: 'Application Inventory', description: 'All VMs with linked applications' },
  { name: 'owner', label: 'Owner Report', description: 'All VMs sorted by business owner' },
  { name: 'department', label: 'Department Report', description: 'All VMs sorted by department' },
  { name: 'lifecycle', label: 'Lifecycle Report', description: 'All VMs sorted by decommission date' },
];

export function ReportsPage() {
  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Reports" />
        <div className="mb-4 flex justify-end">
          <a href={api.exportVmsUrl()} download="vm-inventory.csv"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
            Export all VMs (CSV)
          </a>
        </div>
        <ul className="space-y-3">
          {REPORTS.map((r) => (
            <li key={r.name} className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{r.label}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{r.description}</p>
              </div>
              <a href={api.reportUrl(r.name)} download={`${r.name}.csv`}
                className="ml-4 flex-shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                Download CSV
              </a>
            </li>
          ))}
        </ul>
      </div>
    </PageTransition>
  );
}
