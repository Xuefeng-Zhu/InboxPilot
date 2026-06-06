/**
 * Phone number and email normalization utilities.
 *
 * Phone numbers are normalized to E.164 format.
 * Email addresses are normalized to lowercase with basic RFC 5322 validation.
 */

/**
 * Normalize a phone number to E.164 format.
 *
 * Rules:
 * - Strip all non-digit characters except a leading `+`
 * - If no country code is present, assume US (+1)
 * - Validate length: E.164 allows max 15 digits (including country code)
 * - The result always starts with `+`
 *
 * @param phone - The raw phone number string
 * @returns The normalized E.164 phone number
 * @throws Error if the input is empty or the result is invalid
 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length === 0) {
    throw new Error('Phone number cannot be empty');
  }

  const hasPlus = trimmed.startsWith('+');

  // Strip everything except digits
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) {
    throw new Error('Phone number contains no digits');
  }

  let normalized: string;

  if (hasPlus) {
    // Already has a country code prefix — use digits as-is
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    // 10-digit number without country code — assume US (+1)
    normalized = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    // 11-digit number starting with 1 — treat as US with country code
    normalized = `+${digits}`;
  } else {
    // Other lengths without a leading + — assume US (+1)
    normalized = `+1${digits}`;
  }

  // Extract just the digits for length validation
  const finalDigits = normalized.slice(1); // remove the leading +

  // E.164: minimum 1 digit (country code) + at least 1 subscriber digit = 2 digits minimum
  // In practice, the shortest valid numbers are around 7 digits total.
  // E.164 max is 15 digits.
  if (finalDigits.length < 2) {
    throw new Error(
      `Invalid phone number: too few digits (${finalDigits.length}). E.164 requires at least a country code and subscriber number.`
    );
  }

  if (finalDigits.length > 15) {
    throw new Error(
      `Invalid phone number: too many digits (${finalDigits.length}). E.164 allows a maximum of 15 digits.`
    );
  }

  return normalized;
}

/**
 * Normalize an email address.
 *
 * Rules:
 * - Trim whitespace
 * - Convert to lowercase
 * - Validate basic RFC 5322 format: must have exactly one `@` with
 *   a non-empty local part and a non-empty domain part containing at least one dot
 *
 * @param email - The raw email string
 * @returns The normalized email address
 * @throws Error if the input is empty or fails validation
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed.length === 0) {
    throw new Error('Email address cannot be empty');
  }

  const lowered = trimmed.toLowerCase();

  // Basic RFC 5322 validation: local@domain
  const atIndex = lowered.indexOf('@');
  const lastAtIndex = lowered.lastIndexOf('@');

  // Must have exactly one @
  if (atIndex === -1 || atIndex !== lastAtIndex) {
    throw new Error('Invalid email address: must contain exactly one @ symbol');
  }

  const localPart = lowered.slice(0, atIndex);
  const domainPart = lowered.slice(atIndex + 1);

  if (localPart.length === 0) {
    throw new Error('Invalid email address: local part (before @) cannot be empty');
  }

  if (domainPart.length === 0) {
    throw new Error('Invalid email address: domain part (after @) cannot be empty');
  }

  // Domain must contain at least one dot
  if (!domainPart.includes('.')) {
    throw new Error('Invalid email address: domain must contain at least one dot');
  }

  // Domain cannot start or end with a dot
  if (domainPart.startsWith('.') || domainPart.endsWith('.')) {
    throw new Error('Invalid email address: domain cannot start or end with a dot');
  }

  return lowered;
}
