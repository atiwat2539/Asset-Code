import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { AccessDeniedPage, NotFoundPage } from '@/features/auth/ErrorPages';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AssetRegistryPage } from '@/features/assets/AssetRegistryPage';
import { AssetDetailPage } from '@/features/assets/AssetDetailPage';
import { QrBarcodePage } from '@/features/qr-barcode/QrBarcodePage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { BorrowingPage } from '@/features/borrowing/BorrowingPage';
import { TransfersPage } from '@/features/transfers/TransfersPage';
import { MaintenancePage } from '@/features/maintenance/MaintenancePage';
import { DisposalPage } from '@/features/disposal/DisposalPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { AuditLogsPage } from '@/features/audit-logs/AuditLogsPage';
import { UsersAndDepartmentsPage } from '@/features/users/UsersAndDepartmentsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { LoadingState } from '@/components/ui/common';
import type { UserRole } from '@/types/database';

function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}) {
  const { session, role, isLoading, isConfigured } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="p-8">
        <LoadingState message="กำลังตรวจสอบสิทธิ์การเข้าถึง..." />
      </div>
    );
  }

  // หากตั้งค่า Supabase แล้วแต่ยังไม่ได้ Login ให้ส่งไปหน้า /login
  // หากยังไม่ได้ตั้งค่า Supabase ให้เข้าดูหน้า UI พร้อม Setup Guide Banner ได้โดยไม่แอบอ้างว่าบันทึกข้อมูลสำเร็จ
  if (isConfigured && !session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (isConfigured && allowedRoles && !allowedRoles.includes(role)) {
    return <AccessDeniedPage />;
  }

  return <>{children}</>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/access-denied" element={<AccessDeniedPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="assets" element={<AssetRegistryPage />} />
          <Route path="assets/:id" element={<AssetDetailPage />} />
          <Route path="qr-barcode" element={<QrBarcodePage />} />

          <Route
            path="inventory"
            element={
              <ProtectedRoute allowedRoles={['admin', 'asset_officer']}>
                <InventoryPage />
              </ProtectedRoute>
            }
          />

          <Route path="borrowing" element={<BorrowingPage />} />
          <Route path="transfers" element={<TransfersPage />} />
          <Route path="maintenance" element={<MaintenancePage />} />

          <Route
            path="disposal"
            element={
              <ProtectedRoute allowedRoles={['admin', 'asset_officer']}>
                <DisposalPage />
              </ProtectedRoute>
            }
          />

          <Route path="calendar" element={<CalendarPage />} />

          <Route
            path="reports"
            element={
              <ProtectedRoute allowedRoles={['admin', 'asset_officer']}>
                <ReportsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="audit-logs"
            element={
              <ProtectedRoute allowedRoles={['admin', 'asset_officer']}>
                <AuditLogsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="users"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <UsersAndDepartmentsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="settings"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <SettingsPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
