import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export const homeFor = (role) => ({ customer: "/dashboard", owner: "/owner", admin: "/admin" }[role] || "/");

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem("nxp_token")) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      localStorage.removeItem("nxp_token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const applySession = (data) => {
    localStorage.setItem("nxp_token", data.token);
    setUser(data.user);
    return data.user;
  };
  const login = async (email, password) => applySession((await api.post("/auth/login", { email, password })).data);
  const register = async (payload) => applySession((await api.post("/auth/register", payload)).data);
  const logout = () => {
    localStorage.removeItem("nxp_token");
    setUser(null);
  };

  return <AuthCtx.Provider value={{ user, setUser, loading, login, register, logout, refresh }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function RequireRole({ role, children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="min-h-[60vh] grid place-items-center text-muted-foreground" data-testid="auth-loading">Loading…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}
