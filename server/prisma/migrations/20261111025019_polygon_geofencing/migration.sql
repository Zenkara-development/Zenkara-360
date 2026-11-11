-- AlterTable
ALTER TABLE "office_locations" ADD COLUMN     "area_square_meters" DOUBLE PRECISION,
ADD COLUMN     "geofence_type" TEXT NOT NULL DEFAULT 'CIRCLE',
ADD COLUMN     "polygon" JSONB;

-- CreateTable
CREATE TABLE "attendance_geofence_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "record_id" TEXT,
    "office_location_id" TEXT,
    "office_name" TEXT,
    "event_type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'HEARTBEAT',
    "seq" INTEGER NOT NULL,

    CONSTRAINT "attendance_geofence_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_geofence_events_org_id_user_id_at_idx" ON "attendance_geofence_events"("org_id", "user_id", "at");

-- CreateIndex
CREATE INDEX "attendance_geofence_events_org_id_office_location_id_at_idx" ON "attendance_geofence_events"("org_id", "office_location_id", "at");

-- CreateIndex
CREATE INDEX "attendance_geofence_events_record_id_at_idx" ON "attendance_geofence_events"("record_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_geofence_events_user_id_seq_key" ON "attendance_geofence_events"("user_id", "seq");

-- AddForeignKey
ALTER TABLE "attendance_geofence_events" ADD CONSTRAINT "attendance_geofence_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_geofence_events" ADD CONSTRAINT "attendance_geofence_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_geofence_events" ADD CONSTRAINT "attendance_geofence_events_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_geofence_events" ADD CONSTRAINT "attendance_geofence_events_office_location_id_fkey" FOREIGN KEY ("office_location_id") REFERENCES "office_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
