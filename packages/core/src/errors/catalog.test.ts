import { describe, it, expect } from 'vitest'
import {
  ProtocolError,
  MissingAuthError,
  InvalidSignatureError,
  UnregisteredBuilderError,
  NotOwnerError,
  ExpiredTokenError,
  GrantRequiredError,
  GrantExpiredError,
  GrantRevokedError,
  ScopeMismatchError,
  ContentTooLargeError,
} from './catalog.js'

describe('ProtocolError', () => {
  it('has correct code, errorCode, message, and details', () => {
    const details = { reason: 'test' }
    const err = new ProtocolError(400, 'BAD_REQUEST', 'Bad request', details)

    expect(err.code).toBe(400)
    expect(err.errorCode).toBe('BAD_REQUEST')
    expect(err.message).toBe('Bad request')
    expect(err.details).toEqual({ reason: 'test' })
  })

  it('toJSON() returns serializable object', () => {
    const err = new ProtocolError(400, 'BAD_REQUEST', 'Bad request', {
      field: 'name',
    })
    const json = err.toJSON()

    expect(json).toEqual({
      error: {
        code: 400,
        errorCode: 'BAD_REQUEST',
        message: 'Bad request',
        details: { field: 'name' },
      },
    })

    // Omits details when undefined
    const errNoDetails = new ProtocolError(400, 'BAD_REQUEST', 'Bad request')
    const jsonNoDetails = errNoDetails.toJSON()
    expect(jsonNoDetails).toEqual({
      error: {
        code: 400,
        errorCode: 'BAD_REQUEST',
        message: 'Bad request',
      },
    })

    // Roundtrips through JSON.stringify
    expect(() => JSON.stringify(json)).not.toThrow()
  })

  it('subclasses have correct HTTP code and error code', () => {
    const cases: Array<{
      Cls: new (d?: Record<string, unknown>) => ProtocolError
      code: number
      errorCode: string
    }> = [
      { Cls: MissingAuthError, code: 401, errorCode: 'MISSING_AUTH' },
      { Cls: InvalidSignatureError, code: 401, errorCode: 'INVALID_SIGNATURE' },
      { Cls: UnregisteredBuilderError, code: 401, errorCode: 'UNREGISTERED_BUILDER' },
      { Cls: NotOwnerError, code: 401, errorCode: 'NOT_OWNER' },
      { Cls: ExpiredTokenError, code: 401, errorCode: 'EXPIRED_TOKEN' },
      { Cls: GrantRequiredError, code: 403, errorCode: 'GRANT_REQUIRED' },
      { Cls: GrantExpiredError, code: 403, errorCode: 'GRANT_EXPIRED' },
      { Cls: GrantRevokedError, code: 403, errorCode: 'GRANT_REVOKED' },
      { Cls: ScopeMismatchError, code: 403, errorCode: 'SCOPE_MISMATCH' },
      { Cls: ContentTooLargeError, code: 413, errorCode: 'CONTENT_TOO_LARGE' },
    ]

    for (const { Cls, code, errorCode } of cases) {
      const err = new Cls()
      expect(err.code).toBe(code)
      expect(err.errorCode).toBe(errorCode)
    }
  })

  it('all subclasses extend Error and ProtocolError', () => {
    const subclasses = [
      MissingAuthError,
      InvalidSignatureError,
      UnregisteredBuilderError,
      NotOwnerError,
      ExpiredTokenError,
      GrantRequiredError,
      GrantExpiredError,
      GrantRevokedError,
      ScopeMismatchError,
      ContentTooLargeError,
    ]

    for (const Cls of subclasses) {
      const err = new Cls()
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(ProtocolError)
    }
  })

  it('error name property is set to the class name', () => {
    expect(new ProtocolError(400, 'X', 'x').name).toBe('ProtocolError')
    expect(new MissingAuthError().name).toBe('MissingAuthError')
    expect(new InvalidSignatureError().name).toBe('InvalidSignatureError')
    expect(new UnregisteredBuilderError().name).toBe('UnregisteredBuilderError')
    expect(new NotOwnerError().name).toBe('NotOwnerError')
    expect(new ExpiredTokenError().name).toBe('ExpiredTokenError')
    expect(new GrantRequiredError().name).toBe('GrantRequiredError')
    expect(new GrantExpiredError().name).toBe('GrantExpiredError')
    expect(new GrantRevokedError().name).toBe('GrantRevokedError')
    expect(new ScopeMismatchError().name).toBe('ScopeMismatchError')
    expect(new ContentTooLargeError().name).toBe('ContentTooLargeError')
  })
})
