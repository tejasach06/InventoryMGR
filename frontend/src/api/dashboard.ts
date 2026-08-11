import { API_PREFIX, apiRequest } from './core';
import type { DashboardStats, ReportSummary } from './types';

export const dashboard = {
  getDashboard: () => apiRequest<DashboardStats>('/dashboard'),
  reportUrl: (name: string) => `${API_PREFIX}/reports/${name}?format=csv`,
  getReportSummary: () => apiRequest<ReportSummary>('/reports/summary'),
};
