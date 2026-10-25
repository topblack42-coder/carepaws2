import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import { ToastProvider } from "./context/ToastContext";
import ProtectedRoute from "./components/layout/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import { LoadingState } from "./components/ui/StateDisplays";

// Auth
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";

// Overview
import Dashboard from "./pages/Dashboard";
// Lazy-loaded: these are the two heaviest routes (charts/export libs), and
// most sessions never visit them, so splitting them out of the main chunk
// cuts the initial bundle instead of paying for them on every page load.
const Analytics = lazy(() => import("./pages/Analytics"));
const Reports = lazy(() => import("./pages/Reports"));

// Pet operations
import ManagePets from "./pages/ManagePets";
import PetGallery from "./pages/PetGallery";
import PetDetails from "./pages/PetDetails";
import PetManagement from "./pages/PetManagement";
import Inventory from "./pages/Inventory";

// Adoption pipeline
import Adoptions from "./pages/Adoptions";
import AdoptionForm from "./pages/AdoptionForm";
import ApplicationDetails from "./pages/ApplicationDetails";
import AdoptionScheduling from "./pages/AdoptionScheduling";
import Adopters from "./pages/Adopters";
import Interviews from "./pages/Interviews";
import HomeVisits from "./pages/HomeVisits";
import RiskAssessments from "./pages/RiskAssessments";
import DocumentReview from "./pages/DocumentReview";

// Foster & health
import Fosters from "./pages/Fosters";
import Monitoring from "./pages/Monitoring";
import Health from "./pages/Health";

// Community
import Events from "./pages/Events";
import Shifts from "./pages/Shifts";
import Volunteer from "./pages/Volunteer";
import FeedbackReviews from "./pages/FeedbackReviews";
import ContentManagement from "./pages/ContentManagement";

// Finance
import PaymentsAdmin from "./pages/PaymentsAdmin";
import Donations from "./pages/Donations";
import GoodsDonations from "./pages/GoodsDonations";

// Communication
import Chat from "./pages/Chat";
import NotificationsAdmin from "./pages/NotificationsAdmin";

// People & access
import Accounts from "./pages/Accounts";
import StaffManagement from "./pages/StaffManagement";
import UserVerification from "./pages/UserVerification";
import ShelterManagement from "./pages/ShelterManagement";
import CageManagement from "./pages/CageManagement";

// System
import AuditLogs from "./pages/AuditLogs";
import EmergencyReports from "./pages/EmergencyReports";
import Settings from "./pages/Settings";

function Protected({ children, roles }: { children: ReactNode; roles?: ("staff" | "admin" | "super_admin")[] }) {
  return (
    <ProtectedRoute roles={roles}>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RealtimeProvider>
      <ToastProvider>
        <Routes>
          {/* Auth — unauthenticated */}
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          {/* Overview */}
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route
            path="/analytics"
            element={
              <Protected>
                <Suspense fallback={<LoadingState label="Loading analytics…" />}>
                  <Analytics />
                </Suspense>
              </Protected>
            }
          />
          <Route
            path="/reports"
            element={
              <Protected>
                <Suspense fallback={<LoadingState label="Loading reports…" />}>
                  <Reports />
                </Suspense>
              </Protected>
            }
          />

          {/* Pet operations */}
          <Route path="/pets" element={<Protected><ManagePets /></Protected>} />
          <Route path="/pets/gallery" element={<Protected><PetGallery /></Protected>} />
          <Route path="/pets/management" element={<Protected><PetManagement /></Protected>} />
          <Route path="/pets/:id" element={<Protected><PetDetails /></Protected>} />
          <Route path="/inventory" element={<Protected><Inventory /></Protected>} />

          {/* Adoption pipeline */}
          <Route path="/adoptions" element={<Protected><Adoptions /></Protected>} />
          <Route path="/adoptions/new" element={<Protected><AdoptionForm /></Protected>} />
          <Route path="/adoptions/:id" element={<Protected><ApplicationDetails /></Protected>} />
          <Route path="/adoptions/scheduling" element={<Protected><AdoptionScheduling /></Protected>} />
          <Route path="/adopters" element={<Protected><Adopters /></Protected>} />
          <Route path="/interviews" element={<Protected><Interviews /></Protected>} />
          <Route path="/home-visits" element={<Protected><HomeVisits /></Protected>} />
          <Route path="/risk-assessments" element={<Protected><RiskAssessments /></Protected>} />
          <Route path="/documents" element={<Protected><DocumentReview /></Protected>} />

          {/* Foster & health */}
          <Route path="/fosters" element={<Protected><Fosters /></Protected>} />
          <Route path="/monitoring" element={<Protected><Monitoring /></Protected>} />
          <Route path="/health" element={<Protected><Health /></Protected>} />

          {/* Community */}
          <Route path="/events" element={<Protected><Events /></Protected>} />
          <Route path="/shifts" element={<Protected><Shifts /></Protected>} />
          <Route path="/volunteers" element={<Protected><Volunteer /></Protected>} />
          <Route path="/feedback" element={<Protected><FeedbackReviews /></Protected>} />
          <Route path="/content" element={<Protected><ContentManagement /></Protected>} />

          {/* Finance — admin/super_admin only */}
          <Route path="/payments" element={<Protected roles={["admin", "super_admin"]}><PaymentsAdmin /></Protected>} />
          <Route path="/donations" element={<Protected roles={["admin", "super_admin"]}><Donations /></Protected>} />
          <Route path="/donations/goods" element={<Protected><GoodsDonations /></Protected>} />

          {/* Communication */}
          <Route path="/chat" element={<Protected><Chat /></Protected>} />
          <Route path="/notifications" element={<Protected><NotificationsAdmin /></Protected>} />

          {/* People & access */}
          <Route path="/accounts" element={<Protected roles={["admin", "super_admin"]}><Accounts /></Protected>} />
          <Route path="/staff" element={<Protected roles={["super_admin"]}><StaffManagement /></Protected>} />
          <Route path="/verification" element={<Protected roles={["admin", "super_admin"]}><UserVerification /></Protected>} />
          <Route path="/shelters" element={<Protected roles={["admin", "super_admin"]}><ShelterManagement /></Protected>} />
          <Route path="/cages" element={<Protected roles={["admin", "super_admin"]}><CageManagement /></Protected>} />

          {/* System */}
          <Route path="/audit-logs" element={<Protected roles={["super_admin"]}><AuditLogs /></Protected>} />
          <Route path="/emergency-reports" element={<Protected><EmergencyReports /></Protected>} />
          <Route path="/settings" element={<Protected roles={["admin", "super_admin"]}><Settings /></Protected>} />

          {/* Fallback */}
          <Route
            path="*"
            element={
              <Protected>
                <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
                  <p className="text-lg font-semibold text-gray-900">Page not found</p>
                </div>
              </Protected>
            }
          />
        </Routes>
      </ToastProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}
