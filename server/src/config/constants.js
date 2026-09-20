export const ROLES = {
  SCHOOL_MAKER: 'school_maker',
  SCHOOL_CHECKER: 'school_checker',
  BLOCK: 'block',
  DC: 'dc',
  STATE: 'state',
  ADMIN: 'admin',
};

/** Roles bound to a single school. */
export const SCHOOL_ROLES = [ROLES.SCHOOL_MAKER, ROLES.SCHOOL_CHECKER];

/** Roles that see the whole district / state. */
export const OVERSIGHT_ROLES = [ROLES.STATE, ROLES.ADMIN];

export const CLAIM_STATUS = {
  DRAFT: 'Draft',
  // School checker's queue — the maker has submitted it.
  PENDING_CHECKER: 'Pending Checker Review',
  // Block's queue — the checker has forwarded it.
  PENDING_BLOCK: 'Pending Block Review',
  // DC's queue — the block has forwarded it.
  SUBMITTED: 'Submitted',
  UNDER_QUERY: 'Under Query',
  RESUBMITTED: 'Resubmitted',
  // Sent back down the chain for correction; sits with the maker again.
  RETURNED: 'Returned',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
};

/** Statuses that sit in the DC's actionable queue. */
export const DC_ACTIONABLE = [
  CLAIM_STATUS.SUBMITTED,
  CLAIM_STATUS.RESUBMITTED,
  CLAIM_STATUS.UNDER_QUERY,
];

/**
 * The review chain, in order. The checker hands the claim straight to the DC.
 *
 * The block office is not a stage here: it watches everything under it and
 * carries no action, so nothing waits on it. PENDING_BLOCK survives as a
 * status only because claims raised under the old chain still carry it.
 */
export const REVIEW_CHAIN = [
  { role: ROLES.SCHOOL_MAKER, queue: CLAIM_STATUS.DRAFT, forwardsTo: CLAIM_STATUS.PENDING_CHECKER },
  { role: ROLES.SCHOOL_CHECKER, queue: CLAIM_STATUS.PENDING_CHECKER, forwardsTo: CLAIM_STATUS.SUBMITTED },
];

/** Payment tracking — DC-only, and only meaningful once approved. */
export const PAYMENT_STATUS = {
  UNPAID: 'Unpaid',
  PAID: 'Paid',
  // A payment that went out and came back (bounced account, wrong IFSC,
  // treasury rejection). It must be paid again, so it is kept apart from
  // bills that were never attempted.
  REVERSED: 'Payment Reversed',
};

/** Bills still owed money — what the payment desk must act on. */
export const PAYABLE_STATES = [PAYMENT_STATUS.UNPAID, PAYMENT_STATUS.REVERSED];

export const SLA = {
  NORMAL_DAYS: 7,
  REMINDER_DAY: 7,
  BREACH_DAY: 15,
  PAUSE_ON_QUERY: true,
};

export const AUDIT_ACTIONS = {
  LOGIN: 'User Login',
  CLAIM_DRAFTED: 'Claim Drafted',
  CLAIM_SUBMITTED: 'Claim Submitted',
  CLAIM_FORWARDED: 'Claim Forwarded',
  CLAIM_RETURNED: 'Claim Returned',
  CLAIM_APPROVED: 'Claim Approved',
  CLAIM_BULK_APPROVED: 'Claims Bulk Approved',
  CLAIM_REJECTED: 'Claim Rejected',
  CLAIM_QUERIED: 'Marked Under Query',
  QUERY_RESPONDED: 'Query Response Submitted',
  CLAIM_RESUBMITTED: 'Claim Resubmitted',
  PAYMENT_MARKED: 'Payment Status Updated',
  PAYMENT_REVERSED: 'Payment Reversed',
  POST_EXPORT_CHANGE: 'Status Changed After Export',
  FILE_UPLOADED: 'Bill Document Uploaded',
  EXPORT: 'Report Exported',
  IMPORT: 'Master Data Imported',
  BUDGET_ALLOCATED: 'Budget Allocated',
  BUDGET_REVISED: 'Budget Revised',
  USER_CREATED: 'User Created',
  USER_UPDATED: 'User Updated',
  USER_TRANSFERRED: 'User Transferred',
  CONFIG_UPDATED: 'Configuration Updated',
};

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms'];
