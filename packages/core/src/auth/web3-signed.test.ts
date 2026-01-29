import { describe, it, expect } from 'vitest';
import { parseWeb3SignedHeader, verifyWeb3Signed } from './web3-signed.js';
import {
  MissingAuthError,
  InvalidSignatureError,
  ExpiredTokenError,
} from '../errors/catalog.js';
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from '../test-utils/wallet.js';

const AUD = 'http://localhost:8080';
const METHOD = 'GET';
const URI = '/v1/data/instagram.profile';

describe('parseWeb3SignedHeader', () => {
  it('throws MissingAuthError for undefined', () => {
    expect(() => parseWeb3SignedHeader(undefined)).toThrow(MissingAuthError);
  });

  it('throws MissingAuthError for empty string', () => {
    expect(() => parseWeb3SignedHeader('')).toThrow(MissingAuthError);
  });

  it('throws InvalidSignatureError for non-Web3Signed prefix', () => {
    expect(() => parseWeb3SignedHeader('Bearer xyz')).toThrow(
      InvalidSignatureError,
    );
  });

  it('throws InvalidSignatureError for missing dot separator', () => {
    expect(() => parseWeb3SignedHeader('Web3Signed malformed')).toThrow(
      InvalidSignatureError,
    );
  });

  it('parses a valid header correctly', async () => {
    const wallet = createTestWallet(0);
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: AUD,
      method: METHOD,
      uri: URI,
    });

    const result = parseWeb3SignedHeader(header);
    expect(result.payload.aud).toBe(AUD);
    expect(result.payload.method).toBe(METHOD);
    expect(result.payload.uri).toBe(URI);
    expect(result.signature).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(result.payloadBase64.length).toBeGreaterThan(0);
  });
});

describe('verifyWeb3Signed', () => {
  it('returns correct signer for a valid header', async () => {
    const wallet = createTestWallet(0);
    const now = Math.floor(Date.now() / 1000);
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: AUD,
      method: METHOD,
      uri: URI,
      iat: now,
      exp: now + 300,
    });

    const result = await verifyWeb3Signed({
      headerValue: header,
      expectedOrigin: AUD,
      expectedMethod: METHOD,
      expectedPath: URI,
      now,
    });

    expect(result.signer.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(result.payload.aud).toBe(AUD);
  });

  it('throws InvalidSignatureError on audience mismatch', async () => {
    const wallet = createTestWallet(0);
    const now = Math.floor(Date.now() / 1000);
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: 'http://wrong-origin.com',
      method: METHOD,
      uri: URI,
      iat: now,
      exp: now + 300,
    });

    await expect(
      verifyWeb3Signed({
        headerValue: header,
        expectedOrigin: AUD,
        expectedMethod: METHOD,
        expectedPath: URI,
        now,
      }),
    ).rejects.toThrow(InvalidSignatureError);
  });

  it('throws InvalidSignatureError on method mismatch', async () => {
    const wallet = createTestWallet(0);
    const now = Math.floor(Date.now() / 1000);
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: AUD,
      method: 'POST',
      uri: URI,
      iat: now,
      exp: now + 300,
    });

    await expect(
      verifyWeb3Signed({
        headerValue: header,
        expectedOrigin: AUD,
        expectedMethod: METHOD,
        expectedPath: URI,
        now,
      }),
    ).rejects.toThrow(InvalidSignatureError);
  });

  it('throws InvalidSignatureError on URI mismatch', async () => {
    const wallet = createTestWallet(0);
    const now = Math.floor(Date.now() / 1000);
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: AUD,
      method: METHOD,
      uri: '/v1/data/wrong.scope',
      iat: now,
      exp: now + 300,
    });

    await expect(
      verifyWeb3Signed({
        headerValue: header,
        expectedOrigin: AUD,
        expectedMethod: METHOD,
        expectedPath: URI,
        now,
      }),
    ).rejects.toThrow(InvalidSignatureError);
  });

  it('throws ExpiredTokenError for expired token', async () => {
    const wallet = createTestWallet(0);
    const pastTime = Math.floor(Date.now() / 1000) - 1000;
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: AUD,
      method: METHOD,
      uri: URI,
      iat: pastTime - 300,
      exp: pastTime,
    });

    const now = Math.floor(Date.now() / 1000);
    await expect(
      verifyWeb3Signed({
        headerValue: header,
        expectedOrigin: AUD,
        expectedMethod: METHOD,
        expectedPath: URI,
        now,
      }),
    ).rejects.toThrow(ExpiredTokenError);
  });

  it('throws ExpiredTokenError for future iat beyond skew', async () => {
    const wallet = createTestWallet(0);
    const now = Math.floor(Date.now() / 1000);
    const futureIat = now + 600; // 10 minutes in the future, well beyond 300s skew
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: AUD,
      method: METHOD,
      uri: URI,
      iat: futureIat,
      exp: futureIat + 300,
    });

    await expect(
      verifyWeb3Signed({
        headerValue: header,
        expectedOrigin: AUD,
        expectedMethod: METHOD,
        expectedPath: URI,
        now,
      }),
    ).rejects.toThrow(ExpiredTokenError);
  });

  it('preserves grantId in the result payload', async () => {
    const wallet = createTestWallet(0);
    const now = Math.floor(Date.now() / 1000);
    const grantId = 'test-grant-123';
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: AUD,
      method: METHOD,
      uri: URI,
      iat: now,
      exp: now + 300,
      grantId,
    });

    const result = await verifyWeb3Signed({
      headerValue: header,
      expectedOrigin: AUD,
      expectedMethod: METHOD,
      expectedPath: URI,
      now,
    });

    expect(result.payload.grantId).toBe(grantId);
  });
});
