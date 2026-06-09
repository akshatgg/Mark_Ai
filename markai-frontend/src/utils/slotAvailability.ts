/**
 * Slot Availability Utility
 *
 * Handles slot conflict detection between Screenox schedules and booking slots.
 * Slot ID format: "${date.toISOString()}-${hour}"
 * Example: "2026-01-14T00:00:00.000Z-10" (10:00 slot on Jan 14)
 */

export interface BookedSlot {
  eventId: number;
  fromDt: string;  // "2026-01-15 10:00:00"
  toDt: string;    // "2026-01-15 11:00:00"
  campaignId: number;
  displayGroupId: number;
}

export interface SlotConflict {
  slotId: string;
  conflictType: "full" | "partial";
  conflictingSchedule: BookedSlot;
}

/**
 * Parse Screenox datetime "2026-01-15 10:00:00" to Date object
 */
function parseScreenoxDateTime(dtString: string): Date {
  // Format: "YYYY-MM-DD HH:MM:SS"
  const [datePart, timePart] = dtString.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);

  // Create UTC date to match slot ID generation
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/**
 * Check if a Screenox schedule conflicts with a slot
 * Returns true if ANY overlap exists
 */
function doesScheduleConflictWithSlot(
  schedule: BookedSlot,
  slotId: string
): { conflicts: boolean; type: "full" | "partial" | null } {
  // Parse slot ID: "2026-01-14T00:00:00.000Z-10"
  const lastHyphenIndex = slotId.lastIndexOf("-");
  if (lastHyphenIndex === -1) return { conflicts: false, type: null };

  const dateISOPart = slotId.substring(0, lastHyphenIndex);
  const hourPart = parseInt(slotId.substring(lastHyphenIndex + 1), 10);

  if (isNaN(hourPart)) return { conflicts: false, type: null };

  const slotDate = new Date(dateISOPart);
  if (isNaN(slotDate.getTime())) return { conflicts: false, type: null };

  // Slot times in UTC
  const slotStart = new Date(slotDate);
  slotStart.setUTCHours(hourPart, 0, 0, 0);

  const slotEnd = new Date(slotDate);
  if (hourPart === 23) {
    slotEnd.setUTCHours(23, 59, 0, 0);
  } else {
    slotEnd.setUTCHours(hourPart + 1, 0, 0, 0);
  }

  // Parse Screenox schedule times
  const scheduleStart = parseScreenoxDateTime(schedule.fromDt);
  const scheduleEnd = parseScreenoxDateTime(schedule.toDt);

  // Check for overlap: (StartA < EndB) AND (EndA > StartB)
  const hasOverlap =
    slotStart.getTime() < scheduleEnd.getTime() &&
    slotEnd.getTime() > scheduleStart.getTime();

  if (!hasOverlap) {
    return { conflicts: false, type: null };
  }

  // Determine if full or partial conflict
  // Full conflict: schedule completely covers the slot
  const isFull =
    scheduleStart.getTime() <= slotStart.getTime() &&
    scheduleEnd.getTime() >= slotEnd.getTime();

  return {
    conflicts: true,
    type: isFull ? "full" : "partial"
  };
}

/**
 * Get all conflicting slot IDs from a list of booked schedules
 */
export function getConflictingSlots(
  bookedSchedules: BookedSlot[],
  allSlotIds: string[]
): Map<string, SlotConflict> {
  const conflicts = new Map<string, SlotConflict>();

  for (const slotId of allSlotIds) {
    for (const schedule of bookedSchedules) {
      const { conflicts: hasConflict, type } = doesScheduleConflictWithSlot(
        schedule,
        slotId
      );

      if (hasConflict && type) {
        // Store the conflict (prioritize full conflicts over partial)
        const existing = conflicts.get(slotId);
        if (!existing || (type === "full" && existing.conflictType === "partial")) {
          conflicts.set(slotId, {
            slotId,
            conflictType: type,
            conflictingSchedule: schedule,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Helper: Get date range for a week of slots
 */
export function getSlotDateRange(startDate: Date): { fromDate: string; toDate: string } {
  const from = new Date(startDate);
  from.setHours(0, 0, 0, 0);

  const to = new Date(startDate);
  to.setDate(to.getDate() + 6); // 7 days
  to.setHours(23, 59, 59, 999);

  // Format as "YYYY-MM-DD"
  const formatDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  return {
    fromDate: formatDate(from),
    toDate: formatDate(to),
  };
}
