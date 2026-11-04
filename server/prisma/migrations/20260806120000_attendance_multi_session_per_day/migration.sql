-- Allow multiple check-in/check-out sessions per employee per day. Each
-- AttendanceRecord row already models one session end-to-end (its own
-- check-in/out timestamps + verification snapshot); the only thing stopping
-- more than one per day was this unique constraint. Replaced with a regular
-- (non-unique) index — still fast for "give me this user's records for this
-- date" lookups, just no longer enforces at most one row.
DROP INDEX "attendance_records_user_id_date_key";
CREATE INDEX "attendance_records_user_id_date_idx" ON "attendance_records"("user_id", "date");
