import { z } from 'zod';
import { ROLES, CLAIM_STATUS, PAYMENT_STATUS } from './constants.js';

/* Multipart bodies arrive as strings, so numeric/boolean fields are coerced. */

export const loginSchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/, 'Invalid GSTIN format')
  .or(z.literal(''));

const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code')
  .or(z.literal(''));

const objectId = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/**
 * Bill entry form. Field order mirrors the screen: the vendor's bank details
 * and the scheme/budget head are captured first, then the bill itself.
 */
export const claimSchema = z.object({
  // 1. Vendor & payment details
  vendorName: z.string().trim().min(2, 'Enter the vendor name (at least 2 characters)'),
  vendorBankAccount: z
    .string()
    .trim()
    .min(6, 'Enter the vendor account number (6-20 digits)')
    .regex(/^\d{6,20}$/, 'Account number must be 6-20 digits'),
  vendorIfsc: ifsc.optional().default(''),
  vendorBankName: z.string().trim().default(''),
  vendorGstin: gstin.optional().default(''),

  // 2. Scheme / budget head (category drives the budget head)
  category: z.string().trim().min(1, 'Select a scheme / budget head'),

  // 3. Bill details
  billNumber: z.string().trim().min(1, 'Bill number is required'),
  billDate: z.coerce.date({ errorMap: () => ({ message: 'Provide a valid bill date' }) }),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  description: z.string().trim().default(''),

  saveAsDraft: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

/**
 * An edit may also send the bill on. A returned claim is corrected and
 * resubmitted in one step, so the form carries the intent with the changes
 * rather than leaving a saved-but-unsent bill behind.
 */
export const claimUpdateSchema = claimSchema.partial().extend({
  sendForReview: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const remarksSchema = z.object({
  remarks: z.string().trim().default(''),
});

/** Checker and block may only record a remark, so it must be meaningful. */
export const reviewRemarkSchema = z.object({
  remarks: z.string().trim().min(3, 'Enter a remark of at least 3 characters'),
});

export const returnSchema = z.object({
  remarks: z.string().trim().min(5, 'Explain what the maker must correct (at least 5 characters)'),
});

export const rejectSchema = z.object({
  remarks: z.string().trim().min(5, 'A rejection reason of at least 5 characters is required'),
});

/** Withdrawing a rejection is a decision reversed, so it is written down. */
export const reopenSchema = z.object({
  remarks: z.string().trim().min(5, 'Explain why the rejection is being withdrawn (at least 5 characters)'),
});

export const querySchema = z.object({
  queryText: z.string().trim().min(5, 'Describe what the school needs to correct'),
});

export const queryResponseSchema = z.object({
  response: z.string().trim().min(5, 'Enter your response to the query'),
});

export const bulkApproveSchema = z.object({
  claimIds: z
    .array(objectId)
    .min(1, 'Select at least one bill to approve')
    .max(200, 'Approve at most 200 bills at a time'),
  remarks: z.string().trim().default(''),
});

export const paymentSchema = z
  .object({
    paymentStatus: z.enum(Object.values(PAYMENT_STATUS), {
      errorMap: () => ({ message: 'Payment status must be Unpaid, Paid or Payment Reversed' }),
    }),
    paymentRef: z.string().trim().default(''),
    remarks: z.string().trim().default(''),
  })
  .refine(
    (v) => v.paymentStatus !== PAYMENT_STATUS.REVERSED || v.remarks.length >= 5,
    { path: ['remarks'], message: 'Record why the payment came back (at least 5 characters)' }
  );

/** Changing the status of an already-exported bill always needs a remark. */
export const reviseStatusSchema = z.object({
  status: z.enum([CLAIM_STATUS.APPROVED, CLAIM_STATUS.REJECTED, CLAIM_STATUS.UNDER_QUERY], {
    errorMap: () => ({ message: 'Status must be Approved, Rejected or Under Query' }),
  }),
  remarks: z.string().trim().min(5, 'A remark of at least 5 characters is required'),
});

export const schoolSchema = z.object({
  code: z.string().trim().min(1, 'School code is required'),
  name: z.string().trim().min(2, 'Enter the school name (at least 2 characters)'),
  block: z.string().trim().min(1, 'Block is required'),
  blockRef: objectId.optional(),
  cluster: z.string().trim().default(''),
  district: z.string().trim().default('Dhubri'),
  category: z.string().trim().default(''),
  lowestClass: z.string().trim().default(''),
  highestClass: z.string().trim().default(''),
  headTeacher: z.string().trim().default(''),
  mobile: z.string().trim().default(''),
  email: z.string().trim().toLowerCase().email('Invalid email').or(z.literal('')).default(''),
  assembly: z.string().trim().default(''),
  gstin: gstin.optional().default(''),
  dcOffice: objectId.optional(),
  bank: z
    .object({
      accountNumber: z.string().trim().default(''),
      bankName: z.string().trim().default(''),
      ifsc: ifsc.optional().default(''),
      branch: z.string().trim().default(''),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

export const schoolUpdateSchema = schoolSchema.partial();

export const blockSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, 'Block code is required'),
  name: z.string().trim().min(2, 'Enter the block name (at least 2 characters)'),
  district: z.string().trim().default('Dhubri'),
  dcOffice: objectId,
  officerName: z.string().trim().default(''),
  email: z.string().trim().toLowerCase().email('Invalid email').or(z.literal('')).default(''),
  mobile: z.string().trim().default(''),
  isActive: z.boolean().optional(),
});

export const blockUpdateSchema = blockSchema.partial();

export const dcOfficeSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, 'Office code is required'),
  name: z.string().trim().min(2, 'Enter the office name (at least 2 characters)'),
  district: z.string().trim().min(1, 'District is required'),
  officerName: z.string().trim().default(''),
  email: z.string().trim().toLowerCase().email('Invalid email').or(z.literal('')).default(''),
  mobile: z.string().trim().default(''),
  isActive: z.boolean().optional(),
});

export const dcOfficeUpdateSchema = dcOfficeSchema.partial();

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Enter the category name (at least 2 characters)'),
  budgetHead: z.string().trim().min(1, 'Budget head is required'),
  maxAmount: z.coerce.number().min(0).default(0),
  isActive: z.boolean().optional(),
});

export const categoryUpdateSchema = categorySchema.partial();

export const userSchema = z.object({
  userId: z.string().trim().min(3, 'User ID must be at least 3 characters'),
  name: z.string().trim().min(2, 'Enter the full name (at least 2 characters)'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(Object.values(ROLES), { errorMap: () => ({ message: 'Invalid role' }) }),
  email: z.string().trim().toLowerCase().email('Invalid email').or(z.literal('')).default(''),
  mobile: z.string().trim().default(''),
  designation: z.string().trim().default(''),
  school: objectId.optional(),
  block: objectId.optional(),
  dcOffice: objectId.optional(),
  isActive: z.boolean().default(true),
});

export const userUpdateSchema = userSchema.partial().omit({ password: true });

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

export const statusSchema = z.object({
  isActive: z.boolean({ errorMap: () => ({ message: 'isActive must be true or false' }) }),
});

export const configSchema = z.object({
  sla: z
    .object({
      normalDays: z.coerce.number().int().positive().optional(),
      reminderDay: z.coerce.number().int().positive().optional(),
      breachDay: z.coerce.number().int().positive().optional(),
      pauseOnQuery: z.boolean().optional(),
    })
    .optional(),
  budget: z
    .object({
      warnOnOverspend: z.boolean().optional(),
      blockOnOverspend: z.boolean().optional(),
    })
    .optional(),
  notifications: z
    .array(
      z.object({
        event: z.string(),
        recipient: z.string(),
        inApp: z.boolean().default(true),
        email: z.boolean().default(true),
        sms: z.boolean().default(true),
      })
    )
    .optional(),
});

const fyLabel = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'Financial year must look like 2026-27');

export const dcBudgetSchema = z.object({
  dcOffice: objectId,
  budgetHead: z.string().trim().min(1, 'Budget head is required'),
  allocated: z.coerce.number().min(0, 'Allocation cannot be negative'),
  financialYear: fyLabel.optional(),
  note: z.string().trim().default(''),
});

export const schoolBudgetSchema = z.object({
  school: objectId,
  budgetHead: z.string().trim().min(1, 'Budget head is required'),
  allocated: z.coerce.number().min(0, 'Allocation cannot be negative'),
  financialYear: fyLabel.optional(),
  note: z.string().trim().default(''),
});

/* ---- Admin: master upload & login provisioning ---- */

const roleEnum = z.enum([
  ROLES.SCHOOL_MAKER, ROLES.SCHOOL_CHECKER, ROLES.BLOCK, ROLES.DC,
]);

export const provisionPreviewSchema = z.object({
  districtId: z.string().trim().optional(),
  blockId: z.string().trim().optional(),
  roles: z.array(roleEnum).optional(),
});

export const provisionCommitSchema = provisionPreviewSchema.extend({
  // Tick a subset in the preview table, or leave empty for everything.
  userIds: z.array(z.string().trim()).optional(),
  uniquePasswords: z.boolean().optional().default(false),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

/** Transfer: exactly one destination, matching the (possibly new) role. */
export const transferSchema = z
  .object({
    schoolId: z.string().trim().optional(),
    blockId: z.string().trim().optional(),
    districtId: z.string().trim().optional(),
    role: z.enum([ROLES.SCHOOL_MAKER, ROLES.SCHOOL_CHECKER, ROLES.BLOCK, ROLES.DC]).optional(),
    note: z.string().trim().default(''),
  })
  .refine(
    (v) => [v.schoolId, v.blockId, v.districtId].filter(Boolean).length === 1,
    { message: 'Give exactly one destination: schoolId, blockId or districtId' }
  );
