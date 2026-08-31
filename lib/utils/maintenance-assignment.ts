import type { User } from "@/lib/types";

/**
 * Any active non-admin user can participate in a maintenance.
 *
 * The API validates the same rule when it persists the assignment. Keeping
 * the UI aligned prevents valid users such as supervisors from disappearing
 * from the participant selectors.
 */
export function isAssignableMaintenanceUser(user: Pick<User, "estado" | "rol">) {
  return user.estado === "activo" && user.rol !== "admin";
}
