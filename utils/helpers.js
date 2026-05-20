// ─── Date Helpers ───────────────────────────────────────────────────

/** Returns today's date in YYYY-MM-DD format (IST timezone). */
export const getTodayDateString = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

/** Returns true if allocation can still be changed (check-in is in the future). */
export const canModifyAllocationForCheckIn = (checkIn) => {
  if (!checkIn) return false;
  return checkIn.toString().split("T")[0] > getTodayDateString();
};

/** Returns true if request status should auto-promote when allocation is made. */
export const shouldPromoteRequestOnAllocation = (status) => {
  const normalized = (status || "").toString().trim().toUpperCase();
  return !normalized || normalized === "PENDING" || normalized === "CANCELLED";
};

/** Returns true if status is ACCEPTED or starts with APPROVED. */
export const isAcceptedOrApprovedStatus = (status) => {
  const normalized = (status || "").toString().trim().toUpperCase();
  return normalized === "ACCEPTED" || normalized.startsWith("APPROVED");
};

/** Normalizes check_in / check_out from different field name conventions. */
export const mapHouseBookingDates = ({ check_in, check_out, check_in_date, check_out_date }) => ({
  check_in: check_in || check_in_date,
  check_out: check_out || check_out_date
});
