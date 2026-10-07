// Validation for the payment screenshot (sent as a data URL). Only real PNG / JPEG / WEBP images are accepted.
export const MAX_PROOF_BYTES = 2_000_000;

export function parseProofImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) return null;
  const isPng = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isWebp = bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  const ok = (m[1] === 'image/png' && isPng) || (m[1] === 'image/jpeg' && isJpeg) || (m[1] === 'image/webp' && isWebp);
  return ok ? { mime: m[1], bytes } : null;
}
