/** Error with a user-facing message: one sentence with the fix, never a token. */
export class AtlasError extends Error {
  status?: number;

  constructor(message: string, opts?: { status?: number }) {
    super(message);
    this.name = 'AtlasError';
    if (opts?.status !== undefined) this.status = opts.status;
  }
}
