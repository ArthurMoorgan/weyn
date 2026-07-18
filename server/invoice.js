// Booking invoice/receipt PDF — one shared renderer for both the buyer-facing
// and organizer-facing invoice routes in server/app.js, so the two views
// can never drift out of sync with each other.
import PDFDocument from "pdfkit";

// No separate service-fee amount exists anywhere in the schema — Payment.amount
// *is* the full amount charged (see server/app.js's checkout route: `amount:
// unitPrice * qty`, no markup applied on top). The "8% fee" shown to buyers at
// checkout is already baked into the ticket price, not billed as a line item,
// so the invoice says as much rather than inventing a number to split out.
export function renderBookingInvoicePdf(res, booking) {
  const { event, tier, payment } = booking;
  const unitPrice = tier?.price ?? event.price;
  const total = payment?.amount ?? unitPrice * booking.qty;

  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="invoice-${booking.id}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).text("Invoice", { align: "right" });
  doc.fontSize(10).fillColor("#666").text(`Booking ${booking.id}`, { align: "right" });
  doc.moveDown(1.5);

  doc.fillColor("#000").fontSize(14).text(event.title);
  doc.fontSize(10).fillColor("#666")
    .text(new Date(event.startsAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))
    .text(event.venue)
    .text(`Organized by ${event.organizer}`);
  doc.moveDown(1.5);

  const rowY = doc.y;
  doc.fillColor("#000").fontSize(10);
  doc.text("Description", 50, rowY, { width: 260 });
  doc.text("Qty", 310, rowY, { width: 60, align: "right" });
  doc.text("Unit price", 370, rowY, { width: 80, align: "right" });
  doc.text("Amount", 460, rowY, { width: 90, align: "right" });
  doc.moveTo(50, rowY + 15).lineTo(550, rowY + 15).strokeColor("#ccc").stroke();

  const itemY = rowY + 25;
  doc.text(tier?.name || "General admission", 50, itemY, { width: 260 });
  doc.text(String(booking.qty), 310, itemY, { width: 60, align: "right" });
  doc.text(`${unitPrice.toFixed(3)} OMR`, 370, itemY, { width: 80, align: "right" });
  doc.text(`${(unitPrice * booking.qty).toFixed(3)} OMR`, 460, itemY, { width: 90, align: "right" });

  doc.moveDown(3);
  doc.fontSize(9).fillColor("#666").text("Weyn service fee: included in ticket price, not billed separately.", 50);
  doc.moveDown(0.5);
  doc.moveTo(370, doc.y).lineTo(550, doc.y).strokeColor("#ccc").stroke();
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor("#000").text("Total", 370, doc.y, { width: 80 });
  doc.text(`${total.toFixed(3)} OMR`, 460, doc.y - 14, { width: 90, align: "right" });

  doc.moveDown(2);
  doc.fontSize(10).fillColor("#666");
  doc.text(`Payment status: ${payment?.status || "unknown"}`);
  if (payment?.status === "paid" && payment.updatedAt) {
    doc.text(`Paid on: ${new Date(payment.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`);
  }

  doc.end();
}
