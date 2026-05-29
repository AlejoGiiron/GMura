import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import ProtectedRoute from '@/components/layout/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import POSPage from '@/pages/POSPage'
import SalesHistoryPage from '@/pages/SalesHistoryPage'
import ProductsPage from '@/pages/ProductsPage'
import InventoryPage from '@/pages/InventoryPage'
import ReturnsPage from '@/pages/ReturnsPage'
import CustomersPage from '@/pages/CustomersPage'
import ReportsPage from '@/pages/ReportsPage'
import ConfigPage from '@/pages/ConfigPage'
import CashShiftsHistoryPage from '@/pages/CashShiftsHistoryPage'
import LayawaysPage from '@/pages/LayawaysPage'
import SuppliersPage from '@/pages/SuppliersPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/ventas" replace />} />
          <Route path="ventas" element={<POSPage />} />
          <Route path="ventas/historial" element={<SalesHistoryPage />} />
          <Route path="separados" element={<LayawaysPage />} />
          <Route
            path="productos"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <ProductsPage />
              </ProtectedRoute>
            }
          />
          <Route path="inventario" element={<InventoryPage />} />
          <Route path="devoluciones" element={<ReturnsPage />} />
          <Route
            path="proveedores"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <SuppliersPage />
              </ProtectedRoute>
            }
          />
          <Route path="clientes" element={<CustomersPage />} />
          <Route
            path="reportes"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="caja/historial"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <CashShiftsHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="configuracion"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <ConfigPage />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
