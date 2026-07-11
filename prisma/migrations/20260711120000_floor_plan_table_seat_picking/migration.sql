-- Table/seat picking system: one reusable FloorPlan shared by Venue
-- reservations and Event ticketing (assigned-seating events).
--
-- Applied via `prisma db execute` (not `migrate dev`) because
-- `prisma migrate diff` against the live DB also surfaced unrelated
-- pre-existing drift (dropped Event trgm indexes, a dropped
-- Payment.stripeSessionId column, a VenueApplication.photos default
-- change) from prior untracked migrations — none of that is part of this
-- change, so it's deliberately excluded here rather than applied blind.

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "seatId" TEXT;

-- CreateTable
CREATE TABLE "FloorPlan" (
    "id" TEXT NOT NULL,
    "venueId" TEXT,
    "eventId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'table',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorSection" (
    "id" TEXT NOT NULL,
    "floorPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FloorSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorTable" (
    "id" TEXT NOT NULL,
    "floorPlanId" TEXT NOT NULL,
    "sectionId" TEXT,
    "label" TEXT NOT NULL,
    "shape" TEXT NOT NULL DEFAULT 'rect',
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minCapacity" INTEGER NOT NULL DEFAULT 1,
    "maxCapacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorSeat" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',

    CONSTRAINT "FloorSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableAssignment" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT,
    "bookingId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableAssignmentTable" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,

    CONSTRAINT "TableAssignmentTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FloorPlan_venueId_key" ON "FloorPlan"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "FloorPlan_eventId_key" ON "FloorPlan"("eventId");

-- CreateIndex
CREATE INDEX "FloorSection_floorPlanId_idx" ON "FloorSection"("floorPlanId");

-- CreateIndex
CREATE INDEX "FloorTable_floorPlanId_idx" ON "FloorTable"("floorPlanId");

-- CreateIndex
CREATE INDEX "FloorTable_sectionId_idx" ON "FloorTable"("sectionId");

-- CreateIndex
CREATE INDEX "FloorSeat_tableId_idx" ON "FloorSeat"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "TableAssignment_reservationId_key" ON "TableAssignment"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "TableAssignment_bookingId_key" ON "TableAssignment"("bookingId");

-- CreateIndex
CREATE INDEX "TableAssignmentTable_tableId_idx" ON "TableAssignmentTable"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "TableAssignmentTable_assignmentId_tableId_key" ON "TableAssignmentTable"("assignmentId", "tableId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_seatId_key" ON "Ticket"("seatId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "FloorSeat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlan" ADD CONSTRAINT "FloorPlan_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlan" ADD CONSTRAINT "FloorPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorSection" ADD CONSTRAINT "FloorSection_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorTable" ADD CONSTRAINT "FloorTable_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorTable" ADD CONSTRAINT "FloorTable_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "FloorSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorSeat" ADD CONSTRAINT "FloorSeat_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "FloorTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableAssignmentTable" ADD CONSTRAINT "TableAssignmentTable_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TableAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableAssignmentTable" ADD CONSTRAINT "TableAssignmentTable_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "FloorTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
