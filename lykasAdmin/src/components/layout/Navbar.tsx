import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, LogOut, Menu } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { useRealtime, useRealtimeStatus } from "../../context/RealtimeContext";
import IconButton from "../ui/IconButton";

export default function Navbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setMenuOpen(false);
    try {
      await logout();
      navigate("/login");
    } finally {
      if (mounted.current) setLoggingOut(false);
    }
  }

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await api.get("/api/notifications/unread-count");
      if (mounted.current) setUnreadCount(res.data.data.count);
    } catch {
      // Silent — a failed refresh shouldn't disrupt the rest of the UI.
    }
  }, []);

  // Live: the server pushes a change whenever a notification is created or
  // read. The slow interval is only a safety net for a dropped connection.
  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchUnread]);
  useRealtime(["Notification"], fetchUnread);
  const live = useRealtimeStatus();

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
      <IconButton label="Open navigation menu" size="md" onClick={onMenuClick} className="lg:hidden">
        <Menu className="h-5 w-5" />
      </IconButton>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <span
          role="status"
          title={live ? "Live updates connected" : "Live updates reconnecting…"}
          aria-label={live ? "Live updates connected" : "Live updates reconnecting"}
          className={`h-2 w-2 rounded-full ${live ? "bg-status-success" : "bg-gray-300"}`}
        />
        <IconButton label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`} size="md" onClick={() => navigate("/notifications")} className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-danger px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </IconButton>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {user?.displayName?.[0]?.toUpperCase() ?? "?"}
            </div>
            <span className="hidden text-sm font-medium text-gray-700 sm:block">{user?.displayName}</span>
            <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="animate-zoom-in-95 absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            >
              <div className="border-b border-gray-100 px-3 py-2">
                <p className="text-sm font-medium text-gray-900">{user?.displayName}</p>
                <p className="truncate text-xs text-gray-500">{user?.email}</p>
              </div>
              <button
                type="button"
                role="menuitem"
                disabled={loggingOut}
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
