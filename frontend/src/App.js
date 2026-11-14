import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, RequireRole } from "@/lib/auth";
import PublicLayout from "@/components/PublicLayout";
import Home from "@/pages/Home";
import Landing from "@/pages/Landing";
import Venues from "@/pages/Venues";
import VenueDetail from "@/pages/VenueDetail";
import { Login, Signup, ForgotPassword, ResetPassword } from "@/pages/Auth";
import StaticPage from "@/pages/StaticPage";
import { CustomerDashboard, MyBookings } from "@/pages/customer/MyBookings";
import BookingDetail from "@/pages/customer/BookingDetail";
import Profile from "@/pages/customer/Profile";
import OwnerLayout from "@/pages/owner/OwnerLayout";
import { OwnerHome, OwnerBookings } from "@/pages/owner/OwnerPages";
import OwnerWalkin from "@/pages/owner/OwnerWalkin";
import OwnerPricing from "@/pages/owner/OwnerPricing";
import OwnerScan from "@/pages/owner/OwnerScan";
import OwnerSubscription from "@/pages/owner/OwnerSubscription";
import AdminLayout, { AdminHome } from "@/pages/admin/AdminLayout";
import { AdminVenues, AdminVenueManage } from "@/pages/admin/AdminVenues";
import AdminVenueWizard from "@/pages/admin/AdminVenueWizard";
import { AdminOwners, AdminBookings, AdminPricing } from "@/pages/admin/AdminOps";
import { AdminCoupons, AdminFinance, AdminSettings } from "@/pages/admin/AdminMoney";

const C = (el) => <RequireRole role="customer">{el}</RequireRole>;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/book" element={<Home />} />
            <Route path="/venues" element={<Venues />} />
            <Route path="/venues/:id" element={<VenueDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            {["/about", "/contact", "/terms", "/privacy", "/cancellation-policy"].map((p) => <Route key={p} path={p} element={<StaticPage />} />)}
            <Route path="/dashboard" element={C(<CustomerDashboard />)} />
            <Route path="/my-bookings" element={C(<MyBookings />)} />
            <Route path="/bookings/:id" element={C(<BookingDetail />)} />
            <Route path="/profile" element={C(<Profile />)} />
          </Route>
          <Route path="/owner" element={<RequireRole role="owner"><OwnerLayout /></RequireRole>}>
            <Route index element={<OwnerHome />} />
            <Route path="bookings" element={<OwnerBookings />} />
            <Route path="walk-in" element={<OwnerWalkin />} />
            <Route path="pricing" element={<OwnerPricing />} />
            <Route path="scan" element={<OwnerScan />} />
            <Route path="subscription" element={<OwnerSubscription />} />
          </Route>
          <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
            <Route index element={<AdminHome />} />
            <Route path="venues" element={<AdminVenues />} />
            <Route path="venues/new" element={<AdminVenueWizard />} />
            <Route path="venues/:id" element={<AdminVenueManage />} />
            <Route path="owners" element={<AdminOwners />} />
            <Route path="bookings" element={<AdminBookings />} />
            <Route path="pricing" element={<AdminPricing />} />
            <Route path="coupons" element={<AdminCoupons />} />
            <Route path="finance" element={<AdminFinance />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster theme="dark" position="top-center" richColors />
      </BrowserRouter>
    </AuthProvider>
  );
}
