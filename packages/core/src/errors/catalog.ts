/**
 * Typed error catalog mapping to Vana Data Portability Protocol spec §8.2.
 */

export class ProtocolError extends Error {
  constructor(
    public readonly code: number,
    public readonly errorCode: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: {
        code: this.code,
        errorCode: this.errorCode,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}

// 401 — Authentication errors

export class MissingAuthError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(401, 'MISSING_AUTH', 'Missing authentication', details);
  }
}

export class InvalidSignatureError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(401, 'INVALID_SIGNATURE', 'Invalid signature', details);
  }
}

export class UnregisteredBuilderError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(401, 'UNREGISTERED_BUILDER', 'Unregistered builder', details);
  }
}

export class NotOwnerError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(401, 'NOT_OWNER', 'Not the owner', details);
  }
}

export class ExpiredTokenError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(401, 'EXPIRED_TOKEN', 'Token has expired', details);
  }
}

// 403 — Authorization/grant errors

export class GrantRequiredError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(403, 'GRANT_REQUIRED', 'Grant required', details);
  }
}

export class GrantExpiredError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(403, 'GRANT_EXPIRED', 'Grant has expired', details);
  }
}

export class GrantRevokedError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(403, 'GRANT_REVOKED', 'Grant has been revoked', details);
  }
}

export class ScopeMismatchError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(403, 'SCOPE_MISMATCH', 'Scope not granted', details);
  }
}

// 413 — Payload errors

export class ContentTooLargeError extends ProtocolError {
  constructor(details?: Record<string, unknown>) {
    super(413, 'CONTENT_TOO_LARGE', 'Content too large', details);
  }
}
