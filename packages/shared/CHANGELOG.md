# @needgrid/shared changelog

Every change to the contract bumps `version` in `package.json` and adds one line here. Changes are additive only unless A, B and C all agree.

- 1.0.0 (2026-10-27): initial contract v1, copied verbatim from `AGENT_A_BACKEND.md` §5.
- 1.0.1 (2026-10-27): additive. Export a `z.infer` type for every object schema that lacked one (e.g. `PurchaseOffer`, `OrgSummary`, `DatasetNeedRow`). No names or fields changed.
- 1.1.0 (2026-11-02): additive. `NeedCard.deliveryPhotoUrl` (nullable, optional; the API always sends it). `PurchaseView.plan` = `{ priceChange, money }` for proposed purchases. New shared schemas `PriceChange`, `PlannedMoney`, `PurchasePlanSummary` (`PurchasePlanRes` now uses them; same shape). `ApprovePurchaseRes.surplusMoved.moves` (optional; `amountCents` is the total moved). `PurchasePlanReq { offerChannel3Id? }` (P1, B). `CreateInvoiceResult { sponsorInvoice }` = `AgentAction.result` of an executed invoice action.
