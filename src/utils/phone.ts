/**
 * Formats and sanitizes phone numbers strictly into Indonesian E.164 format: 628xxxxxxxxxx
 */
export function sanitizePhoneNumber(input: string): string {
  if (!input) return '';
  // Strip all non-numeric characters
  let cleaned = input.replace(/\D/g, '');

  // Convert leading 08 -> 628
  if (cleaned.startsWith('08')) {
    cleaned = '62' + cleaned.slice(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  } else if (cleaned.startsWith('+62')) {
    cleaned = cleaned.replace('+', '');
  }

  return cleaned;
}

/**
 * Validates whether the phone number is a valid Indonesian mobile number: 628xxxxxxxxxx (10-15 digits total)
 */
export function isValidIndonesianPhone(phone: string): boolean {
  const sanitized = sanitizePhoneNumber(phone);
  const regex = /^628[1-9][0-9]{7,11}$/;
  return regex.test(sanitized);
}

/**
 * Converts phone number to Baileys WhatsApp JID format (e.g. 6281234567890@s.whatsapp.net)
 */
export function phoneToJid(phone: string): string {
  const sanitized = sanitizePhoneNumber(phone);
  return `${sanitized}@s.whatsapp.net`;
}

/**
 * Extracts phone number from Baileys JID format
 */
export function jidToPhone(jid: string): string {
  if (!jid) return '';
  return jid.split('@')[0].replace(/\D/g, '');
}
