import { paths, SponsorInvoiceListRes } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { listSponsorInvoices } from "../money/invoices";
import { getStaffOrg } from "../plugins/staffAuth";

/** GET /api/staff/invoices: this org's sponsor invoices, newest first (max 100), with pay link and QR code. */
export async function invoiceRoutes(app: FastifyInstance) {
  app.get(paths.staff.invoices, { preHandler: app.requireStaff }, async (req) =>
    SponsorInvoiceListRes.parse({ invoices: await listSponsorInvoices(getStaffOrg(req).id) }),
  );
}
