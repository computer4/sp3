import { z } from 'zod';

export const email = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

export const password = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

/**
 * Accepts Indian mobile numbers (10 digits starting 6–9, optional +91 / 91 / 0 prefix)
 * or international numbers in +<country code><number> form. Stored normalised as +<digits>.
 */
export function normalizeMobile(raw) {
  const cleaned = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^0[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned.slice(1)}`;
  if (/^(\+?91)[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned.slice(-10)}`;
  if (/^\+[1-9]\d{7,14}$/.test(cleaned) && !cleaned.startsWith('+91')) return cleaned;
  return null;
}

export const mobile = z
  .string({ required_error: 'Mobile number is required' })
  .trim()
  .min(1, 'Mobile number is required')
  .transform((v, ctx) => {
    const n = normalizeMobile(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number (e.g. 98765 43210)' });
      return z.NEVER;
    }
    return n;
  });

export const signupSchema = z
  .object({
    name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(100, 'Name is too long'),
    email,
    password,
    confirmPassword: z.string({ required_error: 'Please confirm your password' }).min(1, 'Please confirm your password'),
    mobile,
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(128),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10).max(200),
    password,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: 'Enter your current password' }).min(1, 'Enter your current password').max(128),
    newPassword: password,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
