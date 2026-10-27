import type { Ionicons } from "@expo/vector-icons";
import colors from "./colors";

export interface NotificationItem {
  _id: string;
  type?: string;
  title: string;
  message: string;
  isRead: boolean;
  refModel?: string | null;
  refId?: string | null;
  createdAt: string;
}

type IconName = keyof typeof Ionicons.glyphMap;

export interface NotificationMeta {
  icon: IconName;
  /** Icon colour. */
  fg: string;
  /** Soft circle behind the icon. */
  bg: string;
}

const GOOD = /(APPROVED|COMPLETED|RECEIVED|STARTED|REVIEWED)$/;
const BAD = /(REJECTED|CANCELLED|FAILED|FLAGGED|REFUNDED)$/;

function iconFor(type: string): IconName {
  if (type.startsWith("APPLICATION") || type.startsWith("RISK")) return "document-text";
  if (type.startsWith("INTERVIEW")) return "people";
  if (type.startsWith("HOME_VISIT")) return "home";
  if (type.startsWith("ADOPTION_PICKUP")) return "gift";
  if (type.startsWith("FOSTER") || type.startsWith("MONITORING")) return "paw";
  if (type.startsWith("EVENT") || type.startsWith("VOLUNTEER")) return "calendar";
  if (type.startsWith("EMERGENCY")) return "alert-circle";
  if (type === "CHAT_MESSAGE") return "chatbubble";
  if (type.startsWith("VACCINATION") || type.startsWith("HEALTH")) return "medkit";
  if (type.startsWith("PAYMENT")) return "card";
  if (type.startsWith("IN_KIND")) return "heart";
  return "notifications";
}

/** Icon + colours for a notification, so the list can be scanned at a glance. */
export function getNotificationMeta(type?: string): NotificationMeta {
  const t = type ?? "GENERAL";
  if (BAD.test(t) || t.startsWith("EMERGENCY")) return { icon: iconFor(t), fg: colors.status.danger, bg: colors.status.dangerBg };
  if (t.endsWith("DUE") || t.endsWith("REMINDER") || t.endsWith("RESCHEDULED")) {
    return { icon: iconFor(t), fg: colors.amber600, bg: colors.status.warningBg };
  }
  if (GOOD.test(t)) return { icon: iconFor(t), fg: colors.primary, bg: colors.mintBg };
  return { icon: iconFor(t), fg: colors.slate, bg: colors.cardBg };
}

/** Where tapping a notification should take the user (null = stay on the list). */
export function getNotificationRoute(n: Pick<NotificationItem, "type" | "refModel" | "refId">): string | null {
  if (n.type === "CHAT_MESSAGE") return "/(tabs)/chat";
  switch (n.refModel) {
    case "Application":
      return n.refId ? `/application-details/${n.refId}` : "/(tabs)/my-applications";
    case "Interview":
    case "HomeVisit":
    case "AdoptionPickup":
      return "/(tabs)/my-applications";
    case "Foster":
      return "/foster-dashboard";
    case "MonitoringReport":
      return "/monitoring-report";
    case "Pet":
      return n.refId ? `/pets/${n.refId}` : null;
    case "Event":
      return "/(tabs)/events";
    case "Payment":
    case "InKindDonation":
      return "/payments";
    default:
      return null;
  }
}
