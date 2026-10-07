// Allowed values for the string "enum" columns in prisma/schema.prisma.

// CLIENT · ADMIN (main admin: every client detail, no payment confirmation) · PAYMENTS (side admin: payments + confirmation)
export const ROLES = ['CLIENT', 'ADMIN', 'PAYMENTS'];
export const STAFF_ROLES = ['ADMIN', 'PAYMENTS'];
export const isStaff = (role) => STAFF_ROLES.includes(role);
export const ACCOUNT_STATUSES = ['ACTIVE', 'BLOCKED'];

/** Money status of an order. */
export const ORDER_STATUSES = ['PENDING', 'PAYMENT_PROCESSING', 'PAID', 'CANCELLED', 'REFUNDED'];
export const PAYMENT_STATUSES = ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'];

/** The project's journey, in order. The admin moves a project through these; the client sees them as a checklist. */
export const STAGES = [
  'APPLIED',
  'VERIFICATION_PENDING',
  'INFORMATION_CONFIRMED',
  'PAYMENT_PENDING',
  'INVOICE_ISSUED',
  'PROJECT_ACTIVE',
  'IN_PRODUCTION',
  'REVISION',
  'FINAL_DELIVERY',
  'COMPLETED',
];
export const stageIndex = (stage) => STAGES.indexOf(stage);

/** Admin work state (the counters): not started yet / being worked on / done. */
export const WORK_STATES = ['REVIEW', 'PROCESS', 'COMPLETED'];

/** Orders that are still waiting for money. */
export const OPEN_ORDER_STATUSES = ['PENDING', 'PAYMENT_PROCESSING'];
/** Orders that no longer count as the client's active subscription. */
export const CLOSED_ORDER_STATUSES = ['CANCELLED', 'REFUNDED'];

/** At or after "Payment Pending" but not paid yet → the admin sees "Payment incomplete". */
export const isPaymentIncomplete = (order) =>
  stageIndex(order.stage) >= stageIndex('PAYMENT_PENDING') && order.status !== 'PAID' && !CLOSED_ORDER_STATUSES.includes(order.status);

/** The client's active subscription: not completed and not cancelled/refunded. */
export const isActiveOrder = (order) => order.stage !== 'COMPLETED' && !CLOSED_ORDER_STATUSES.includes(order.status);
