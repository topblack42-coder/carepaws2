/**
 * Which server models each list endpoint depends on. useResourceList uses
 * this to refetch only when something relevant changed. Longest matching
 * prefix wins. Lists that embed related records (an application shows its
 * pet) also subscribe to those models.
 */
const ENDPOINT_RESOURCES: [prefix: string, resources: string[]][] = [
  ["/api/donations/goods", ["InKindDonation", "InventoryItem"]],
  ["/api/notifications", ["Notification"]],
  ["/api/auth/users", ["User"]],
  ["/api/applications", ["Application", "Pet"]],
  ["/api/pets", ["Pet", "Shelter", "Cage", "CageAssignment"]],
  ["/api/payments", ["Payment"]],
  ["/api/home-visits", ["HomeVisit", "Application"]],
  ["/api/interviews", ["Interview", "Application"]],
  ["/api/adoption-pickups", ["AdoptionPickup", "Application"]],
  ["/api/risk-assessments", ["RiskAssessment", "Application"]],
  ["/api/appointments", ["Appointment"]],
  ["/api/audit-logs", ["AuditLog"]],
  ["/api/shelters", ["Shelter"]],
  ["/api/content", ["ContentItem"]],
  ["/api/feedback", ["Feedback"]],
  ["/api/events", ["Event", "EventRegistration", "EventVolunteerAssignment"]],
  ["/api/inventory", ["InventoryItem"]],
  ["/api/documents", ["UserDocument"]],
  ["/api/volunteers", ["Volunteer"]],
  ["/api/monitoring-reports", ["MonitoringReport"]],
  ["/api/foster", ["Foster", "WeeklyFosterReport"]],
  ["/api/emergency-reports", ["EmergencyReport"]],
];

export function resourcesForEndpoint(endpoint: string): string[] {
  let best: [string, string[]] | undefined;
  for (const entry of ENDPOINT_RESOURCES) {
    if (endpoint.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best ? best[1] : [];
}
