import { describe, it, expect } from 'vitest';
import { normalizePhone, normalizeEmail } from '@support-core/utils/normalization';

describe('normalizePhone', () => {
  it('normalizes a 10-digit US number by adding +1', () => {
    expect(normalizePhone('2125551234')).toBe('+12125551234');
  });

  it('normalizes a formatted US number with dashes and parens', () => {
    expect(normalizePhone('(212) 555-1234')).toBe('+12125551234');
  });

  it('normalizes an 11-digit number starting with 1', () => {
    expect(normalizePhone('12125551234')).toBe('+12125551234');
  });

  it('preserves an already-normalized E.164 number', () => {
    expect(normalizePhone('+12125551234')).toBe('+12125551234');
  });

  it('handles international numbers with leading +', () => {
    expect(normalizePhone('+442071234567')).toBe('+442071234567');
  });

  it('strips spaces and special characters', () => {
    expect(normalizePhone('+44 207 123 4567')).toBe('+442071234567');
  });

  it('throws on empty string', () => {
    expect(() => normalizePhone('')).toThrow('Phone number cannot be empty');
  });

  it('throws on whitespace-only string', () => {
    expect(() => normalizePhone('   ')).toThrow('Phone number cannot be empty');
  });

  it('throws on string with no digits', () => {
    expect(() => normalizePhone('abc')).toThrow('Phone number contains no digits');
  });

  it('throws when result exceeds 15 digits', () => {
    // 16 digits with a leading + should fail
    expect(() => normalizePhone('+1234567890123456')).toThrow('too many digits');
  });

  it('is idempotent — normalizing a normalized number returns the same result', () => {
    const first = normalizePhone('(212) 555-1234');
    const second = normalizePhone(first);
    expect(second).toBe(first);
  });
});

describe('normalizeEmail', () => {
  it('lowercases an email', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('preserves an already-normalized email', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com');
  });

  it('throws on empty string', () => {
    expect(() => normalizeEmail('')).toThrow('Email address cannot be empty');
  });

  it('throws on whitespace-only string', () => {
    expect(() => normalizeEmail('   ')).toThrow('Email address cannot be empty');
  });

  it('throws when no @ symbol is present', () => {
    expect(() => normalizeEmail('userexample.com')).toThrow('exactly one @ symbol');
  });

  it('throws when multiple @ symbols are present', () => {
    expect(() => normalizeEmail('user@@example.com')).toThrow('exactly one @ symbol');
  });

  it('throws when local part is empty', () => {
    expect(() => normalizeEmail('@example.com')).toThrow('local part');
  });

  it('throws when domain part is empty', () => {
    expect(() => normalizeEmail('user@')).toThrow('domain part');
  });

  it('throws when domain has no dot', () => {
    expect(() => normalizeEmail('user@localhost')).toThrow('domain must contain at least one dot');
  });

  it('throws when domain starts with a dot', () => {
    expect(() => normalizeEmail('user@.example.com')).toThrow('domain cannot start or end with a dot');
  });

  it('throws when domain ends with a dot', () => {
    expect(() => normalizeEmail('user@example.com.')).toThrow('domain cannot start or end with a dot');
  });

  it('is idempotent — normalizing a normalized email returns the same result', () => {
    const first = normalizeEmail('  User@Example.COM  ');
    const second = normalizeEmail(first);
    expect(second).toBe(first);
  });
});
