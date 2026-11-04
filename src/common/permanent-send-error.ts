/** A send failure that retrying cannot fix (e.g. a rejected recipient). */
export class PermanentSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentSendError';
  }
}
