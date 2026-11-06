import { ApprovePurchaseRes } from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import { approvalToast } from "@/features/staff/manage/purchases";
import { DEMO_NEEDS, ORG_IDS } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";

const DIAPERS = DEMO_NEEDS.fourteenLeft;
const CHICKEN = "4c1f7a2e-9b3d-4e5f-8a6b-000000000104";

/** A real approval from the mock API (the formula's surplus), with `surplusMoved` as the test needs it. */
function approval(surplusMoved: ApprovePurchaseRes["surplusMoved"]): ApprovePurchaseRes {
  const planned = mockDb.planPurchase(ORG_IDS.harbor, DEMO_NEEDS.priceDrop);
  if (planned.kind !== "ok") throw new Error("expected a plan");
  const approved = mockDb.approvePurchase(ORG_IDS.harbor, planned.plan.purchase.id);
  if (approved.kind !== "ok") throw new Error("expected an approval");
  return ApprovePurchaseRes.parse({ ...approved.approval, surplusMoved });
}

describe("approvalToast: where the surplus went (amountCents is the total)", () => {
  it("one receiver: names it", () => {
    const res = approval({
      toNeedId: DIAPERS,
      toNeedTitle: "Diapers, size 4",
      amountCents: 1200,
      moves: [{ needId: DIAPERS, needTitle: "Diapers, size 4", amountCents: 1200 }],
    });
    expect(approvalToast(res)).toBe("Approved. $12.00 moved to Diapers, size 4.");
  });

  it("several receivers: how many, then each with what it got, as the server sent them", () => {
    const res = approval({
      toNeedId: DIAPERS,
      toNeedTitle: "Diapers, size 4",
      amountCents: 1200,
      moves: [
        { needId: DIAPERS, needTitle: "Diapers, size 4", amountCents: 1100 },
        { needId: CHICKEN, needTitle: "Canned chicken", amountCents: 100 },
      ],
    });
    expect(approvalToast(res)).toBe(
      "Approved. $12.00 moved to 2 needs: Diapers, size 4 ($11.00), Canned chicken ($1.00).",
    );
  });

  it("no `moves` (an older server): the first receiver and the total", () => {
    const res = approval({ toNeedId: DIAPERS, toNeedTitle: "Diapers, size 4", amountCents: 1200 });
    expect(approvalToast(res)).toBe("Approved. $12.00 moved to Diapers, size 4.");
  });
});
