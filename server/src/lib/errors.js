export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message Safe, user-facing message
   * @param {{ code?: string, fields?: Record<string,string> }} [extra]
   */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = extra.code;
    this.fields = extra.fields;
  }
}

/** Parse `input` with a zod schema or throw a 400 with per-field messages. */
export function validate(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION_ERROR', fields });
}
