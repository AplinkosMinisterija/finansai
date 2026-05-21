import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Spinner } from '@/components/ui/spinner';
import { ProtectedRoute } from '@/lib/auth';

const HomePage = lazy(() => import('@/pages/HomePage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const VartotojaiPage = lazy(() => import('@/pages/VartotojaiPage'));
const OrganizacijosPage = lazy(() => import('@/pages/OrganizacijosPage'));
const StatistikaPage = lazy(() => import('@/pages/StatistikaPage'));
const PrasymaiPage = lazy(() => import('@/pages/PrasymaiPage'));
const PrasymoDetailPage = lazy(() => import('@/pages/PrasymoDetailPage'));
const PrasymoEditPage = lazy(() => import('@/pages/PrasymoEditPage'));
const KlasifikatoriaiPage = lazy(() => import('@/pages/KlasifikatoriaiPage'));
const BiudzetasPage = lazy(() => import('@/pages/BiudzetasPage'));
const FinansavimoSaltiniaiPage = lazy(() => import('@/pages/FinansavimoSaltiniaiPage'));

function RouteFallback(): JSX.Element {
  return (
    <div
      className="flex h-full min-h-[40vh] items-center justify-center p-6"
      role="status"
      aria-live="polite"
    >
      <Spinner aria-label="Kraunama" />
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomePage />} />
          <Route path="/vartotojai" element={<VartotojaiPage />} />
          <Route path="/organizacijos" element={<OrganizacijosPage />} />
          <Route path="/statistika" element={<StatistikaPage />} />
          <Route path="/prasymai" element={<PrasymaiPage />} />
          <Route path="/prasymai/:id" element={<PrasymoDetailPage />} />
          <Route path="/prasymai/:id/redaguoti" element={<PrasymoEditPage />} />
          <Route path="/klasifikatoriai" element={<KlasifikatoriaiPage />} />
          <Route path="/biudzetas" element={<BiudzetasPage />} />
          <Route path="/finansavimo-saltiniai" element={<FinansavimoSaltiniaiPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
