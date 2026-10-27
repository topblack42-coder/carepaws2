import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  FileBarChart,
  PawPrint,
  Images,
  Boxes,
  ClipboardList,
  CalendarClock,
  Users,
  Home,
  ShieldCheck,
  FileCheck2,
  HeartHandshake,
  Stethoscope,
  CalendarDays,
  Clock,
  HandHeart,
  MessageSquareHeart,
  FileText,
  CreditCard,
  Gift,
  Package,
  MessagesSquare,
  Bell,
  UserCog,
  ShieldAlert,
  ScrollText,
  Siren,
  Settings as SettingsIcon,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import type { UserRole } from "../../types/auth";

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  roles?: UserRole[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", to: "/", icon: LayoutDashboard },
      { label: "Analytics", to: "/analytics", icon: BarChart3 },
      { label: "Reports", to: "/reports", icon: FileBarChart },
    ],
  },
  {
    label: "Pet operations",
    items: [
      { label: "Manage Pets", to: "/pets", icon: PawPrint },
      { label: "Pet Gallery", to: "/pets/gallery", icon: Images },
      { label: "Pet Management", to: "/pets/management", icon: ClipboardList },
      { label: "Inventory", to: "/inventory", icon: Boxes },
    ],
  },
  {
    label: "Adoption pipeline",
    items: [
      { label: "Adoption Applications", to: "/adoptions", icon: FileText },
      { label: "Adoption Scheduling", to: "/adoptions/scheduling", icon: CalendarClock },
      { label: "Adopter Profiles & Risk", to: "/adopters", icon: Users },
      { label: "Adoption Interviews", to: "/interviews", icon: ClipboardList },
      { label: "Home Visits", to: "/home-visits", icon: Home },
      { label: "Risk Assessments", to: "/risk-assessments", icon: ShieldCheck },
      { label: "Document Review", to: "/documents", icon: FileCheck2 },
    ],
  },
  {
    label: "Foster & health",
    items: [
      { label: "Foster Management", to: "/fosters", icon: HeartHandshake },
      { label: "Post-Adoption Monitoring", to: "/monitoring", icon: Stethoscope },
      { label: "Health & Baby Book", to: "/health", icon: Stethoscope },
    ],
  },
  {
    label: "Community",
    items: [
      { label: "Events", to: "/events", icon: CalendarDays },
      { label: "Shifts & Volunteers", to: "/shifts", icon: Clock },
      { label: "Volunteer Applications", to: "/volunteers", icon: HandHeart },
      { label: "Feedback & Reviews", to: "/feedback", icon: MessageSquareHeart },
      { label: "Content Management", to: "/content", icon: FileText },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Payment Management", to: "/payments", icon: CreditCard, roles: ["admin", "super_admin"] },
      { label: "Donations", to: "/donations", icon: Gift, roles: ["admin", "super_admin"] },
      { label: "Goods Donations", to: "/donations/goods", icon: Package },
    ],
  },
  {
    label: "Communication",
    items: [
      { label: "Chat", to: "/chat", icon: MessagesSquare },
      { label: "Notifications", to: "/notifications", icon: Bell },
    ],
  },
  {
    label: "People & access",
    items: [
      { label: "Manage Accounts", to: "/accounts", icon: UserCog, roles: ["admin", "super_admin"] },
      { label: "Staff Management", to: "/staff", icon: UserCog, roles: ["super_admin"] },
      { label: "User Verification", to: "/verification", icon: ShieldAlert, roles: ["admin", "super_admin"] },
    ],
  },
  {
    label: "System",
    items: [
      { label: "System Audit Logs", to: "/audit-logs", icon: ScrollText, roles: ["super_admin"] },
      { label: "Emergency Reports", to: "/emergency-reports", icon: Siren },
      { label: "Shelter Settings", to: "/settings", icon: SettingsIcon, roles: ["admin", "super_admin"] },
    ],
  },
];

export default function Sidebar() {
  const { hasRole } = useAuth();

  return (
    <aside className="h-full w-64 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-gray-100 px-5">
        <PawPrint className="h-5 w-5 text-primary" aria-hidden="true" />
        <span className="font-semibold text-gray-900">CarePaws Admin</span>
      </div>
      <nav className="space-y-6 px-3 py-4" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => !item.roles || hasRole(...item.roles));
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.label}>
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{group.label}</p>
              <div className="space-y-0.5">
                {visibleItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                        isActive ? "bg-emerald-50 text-primary" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
