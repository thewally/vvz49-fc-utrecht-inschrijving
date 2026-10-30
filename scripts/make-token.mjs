// Draait in de deploy-workflow.
// - Publiceert de publieke sleutel als site/jwks.json (voor Neon: Add provider → JWKS URL)
// - Ondertekent een anoniem token (rol "anonymous") en zet het in site/config.js
// De privésleutel komt uit de GitHub Secret JWT_PRIVATE_KEY en komt nooit op de site.
import { createPrivateKey, createPublicKey, createHash, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const pem = process.env.JWT_PRIVATE_KEY;
if (!pem) { console.error('::error::Secret JWT_PRIVATE_KEY ontbreekt'); process.exit(1); }

const priv = createPrivateKey(pem.replace(/\\n/g, '\n'));
const jwk = createPublicKey(priv).export({ format: 'jwk' });
// RFC 7638-thumbprint als kid
const kid = createHash('sha256').update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).digest('base64url');

writeFileSync('site/jwks.json', JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }, null, 2));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const nu = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT', kid };
const payload = {
  sub: 'vvz49-inschrijfformulier',
  role: 'anonymous',
  iss: 'https://thewally.github.io/vvz49-fc-utrecht-inschrijving',
  iat: nu,
  exp: Math.floor(Date.parse('2027-01-31T00:00:00Z') / 1000), // ruim na de wedstrijd
};
const data = `${b64(header)}.${b64(payload)}`;
const token = `${data}.${sign('RSA-SHA256', Buffer.from(data), priv).toString('base64url')}`;

const cfg = readFileSync('site/config.js', 'utf8').replace('__ANON_TOKEN__', token);
writeFileSync('site/config.js', cfg);
console.log(`jwks.json en token aangemaakt (kid ${kid})`);
