/**
 * Tokens for the tests, signed with throwaway keys the fake site publishes as the directory's
 * JWK sets: a session key (`kid` sd-1) for cookies and a scoped key (`kid` scoped-sd-1) for
 * bearer access tokens, the shapes lib-node's session handler verifies.
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import jwt from 'jsonwebtoken'

const sessionKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const scopedKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })

const jwkSet = (publicKey: KeyObject, kid: string) => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] })

export const jwks = (): { session: object, scoped: object } => ({
  session: jwkSet(sessionKeys.publicKey, 'sd-1'),
  scoped: jwkSet(scopedKeys.publicKey, 'scoped-sd-1')
})

const sign = (privateKey: KeyObject, kid: string, payload: object, header: object = {}) =>
  jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn: '5m', keyid: kid, header: { alg: 'RS256', ...header } })

/** A session cookie header value: the token split in `id_token` and `id_token_sign`. */
export function cookieFor (payload: object): string {
  const [h, p, s] = sign(sessionKeys.privateKey, 'sd-1', payload).split('.')
  return `id_token=${h}.${p}; id_token_sign=${s}`
}

/** A bearer access token (`Bearer` prefix not included). */
export const bearerFor = (payload: object): string => sign(scopedKeys.privateKey, 'scoped-sd-1', payload, { typ: 'at+jwt' })

/** Claims of an access token: one organization, scopes (space-separated) and the audience (the site origin). */
export const nhiClaims = (scope: string, aud: string): object => ({
  ...USER,
  organizations: [{ id: 'org1', name: 'Test Org', role: 'admin' }],
  nhi: 1,
  iss: `${aud}/simple-directory`,
  aud,
  client_id: 'nhi-test',
  jti: 'jti-test',
  scope
})

/** A user without scopes. */
export const USER = {
  email: 'test@example.com',
  id: 'user1',
  name: 'Test User',
  organizations: [
    { id: 'org1', name: 'Test Org', role: 'admin' },
    { id: 'org2', name: 'Other Org', role: 'user' }
  ]
}
