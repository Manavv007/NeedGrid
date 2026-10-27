export const STAFF_KEY_HEADER = "x-staff-key";
export const STAFF_KEY_STORAGE = "needgrid.staffKey";

export const paths = {
  health: "/api/health",
  orgs: "/api/orgs",
  org: (slug: string) => `/api/orgs/${encodeURIComponent(slug)}`,
  orgStream: (slug: string) => `/api/orgs/${encodeURIComponent(slug)}/stream`,
  need: (id: string) => `/api/needs/${id}`,
  createOrder: "/api/donations/orders",
  captureOrder: (orderId: string) => `/api/donations/orders/${encodeURIComponent(orderId)}/capture`,
  impact: (token: string) => `/api/impact/${encodeURIComponent(token)}`,
  match: "/api/match",
  dataset: (name: string) => `/api/dashboard/datasets/${name}`,
  dashboardComplete: "/api/ai/dashboard-complete",
  staff: {
    me: "/api/staff/me",
    needs: "/api/staff/needs",
    need: (id: string) => `/api/staff/needs/${id}`,
    intake: "/api/staff/intake",
    purchasePlan: (needId: string) => `/api/staff/needs/${needId}/purchase-plan`,
    approvePurchase: (purchaseId: string) => `/api/staff/purchases/${purchaseId}/approve`,
    markOrdered: (purchaseId: string) => `/api/staff/purchases/${purchaseId}/ordered`,
    delivery: (needId: string) => `/api/staff/needs/${needId}/delivery`,
    confirmDelivery: (deliveryId: string) => `/api/staff/deliveries/${deliveryId}/confirm`,
    agentChat: "/api/staff/agent/chat",
    actions: "/api/staff/agent/actions",
    approveAction: (id: string) => `/api/staff/agent/actions/${id}/approve`,
    rejectAction: (id: string) => `/api/staff/agent/actions/${id}/reject`,
    invoices: "/api/staff/invoices",
  },
} as const;
