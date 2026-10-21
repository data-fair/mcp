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

const sign = (privateKey: KeyObject, kid: string, payload: object, header: object = {}, expiresIn: jwt.SignOptions['expiresIn'] = '5m') =>
  jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn, keyid: kid, header: { alg: 'RS256', ...header } })

/**
 * A session cookie header value: the token split in `id_token` and `id_token_sign`. A payload
 * carrying a scope is signed by the scoped key set, as the directory signs a scoped session.
 */
export function cookieFor (payload: object, options: { expiresIn?: jwt.SignOptions['expiresIn'] } = {}): string {
  const [privateKey, kid] = 'scope' in payload ? [scopedKeys.privateKey, 'scoped-sd-1'] : [sessionKeys.privateKey, 'sd-1']
  const [h, p, s] = sign(privateKey, kid, payload, {}, options.expiresIn).split('.')
  return `id_token=${h}.${p}; id_token_sign=${s}`
}

/** A bearer access token (`Bearer` prefix not included). */
export const bearerFor = (payload: object): string => sign(scopedKeys.privateKey, 'scoped-sd-1', payload, { typ: 'at+jwt' })

/**
 * Claims of an NHI access token: one organization, scopes (space-separated), issued on `site`.
 * The audience defaults to what SD gives an MCP token: the MCP and the site API.
 */
export const nhiClaims = (scope: string, site: string, aud: string | string[] = [site + '/mcp-server', site]): object => ({
  ...USER,
  organizations: [{ id: 'org1', name: 'Test Org', role: 'admin' }],
  nhi: 1,
  iss: `${site}/simple-directory`,
  aud,
  client_id: 'nhi-test',
  jti: 'jti-test',
  scope
})

/** Claims of a user access token (a dashboard's): no `nhi` flag. */
export const userClaims = (scope: string, site: string, aud: string | string[] = site): object => {
  const { nhi, ...claims } = nhiClaims(scope, site, aud) as { nhi: number }
  return { ...claims, client_id: 'dashboard' }
}

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
