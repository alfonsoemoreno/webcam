const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const STALE_SECONDS = 45;

function getSql() {
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    throw new Error('Missing DATABASE_URL env var');
  }
  return neon(DATABASE_URL);
}

function nowMs() {
  return Date.now();
}

function isActiveDate(dateValue) {
  if (!dateValue) return false;
  const ts = new Date(dateValue).getTime();
  if (Number.isNaN(ts)) return false;
  return ts > nowMs() - STALE_SECONDS * 1000;
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function getRoomFromQuery(req) {
  const room = String(req.query.room || 'main').trim();
  return room || 'main';
}

function randomClientId() {
  return crypto.randomUUID();
}

function getNeonAuthBaseUrl() {
  const baseUrl = String(process.env.NEON_AUTH_BASE_URL || '').trim();
  return baseUrl ? baseUrl.replace(/\/+$/, '') : '';
}

function getJwksUrl() {
  return String(process.env.NEON_AUTH_JWKS_URL || '').trim();
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }
  const [rawHeader, rawPayload, rawSignature] = parts;
  const header = JSON.parse(decodeBase64Url(rawHeader).toString('utf8'));
  const payload = JSON.parse(decodeBase64Url(rawPayload).toString('utf8'));
  const signingInput = Buffer.from(`${rawHeader}.${rawPayload}`);
  const signature = decodeBase64Url(rawSignature);
  return { header, payload, signingInput, signature };
}

let jwksCache = { expiresAt: 0, keys: new Map() };

async function getJwkByKid(kid) {
  const jwksUrl = getJwksUrl();
  if (!jwksUrl) {
    throw new Error('Missing NEON_AUTH_JWKS_URL env var');
  }

  const now = Date.now();
  if (jwksCache.expiresAt < now) {
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      throw new Error(`Failed to load JWKS (${response.status})`);
    }
    const body = await response.json();
    const keys = Array.isArray(body.keys) ? body.keys : [];
    const map = new Map();
    for (const key of keys) {
      if (key && key.kid) {
        map.set(key.kid, key);
      }
    }
    jwksCache = {
      expiresAt: now + 10 * 60 * 1000,
      keys: map,
    };
  }

  return jwksCache.keys.get(kid) || null;
}

function validateJwtClaims(payload) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && nowSeconds >= payload.exp) {
    throw new Error('Token expired');
  }
  if (typeof payload.nbf === 'number' && nowSeconds < payload.nbf) {
    throw new Error('Token not active yet');
  }

  const issuer = String(process.env.NEON_AUTH_ISSUER || '').trim();
  if (issuer && payload.iss !== issuer) {
    throw new Error('Invalid token issuer');
  }

  const audienceRaw = String(process.env.NEON_AUTH_AUDIENCE || '').trim();
  if (audienceRaw) {
    const expectedAudiences = audienceRaw.split(',').map((v) => v.trim()).filter(Boolean);
    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const ok = expectedAudiences.some((aud) => tokenAudiences.includes(aud));
    if (!ok) {
      throw new Error('Invalid token audience');
    }
  }
}

async function verifyJwt(token) {
  const { header, payload, signingInput, signature } = parseJwt(token);
  if (!header.alg) {
    throw new Error('Missing token algorithm');
  }
  if (!header.kid) {
    throw new Error('Missing token kid');
  }

  const jwk = await getJwkByKid(header.kid);
  if (!jwk) {
    throw new Error('Unknown token key id');
  }

  const algConfig = getJwtAlgConfig(header.alg);
  const key = await crypto.webcrypto.subtle.importKey(
    'jwk',
    jwk,
    algConfig.importAlgorithm,
    false,
    ['verify']
  );

  const signatureForVerify = algConfig.joseToDer
    ? joseSignatureToDer(signature, algConfig.josePartLength)
    : signature;

  const valid = await crypto.webcrypto.subtle.verify(
    algConfig.verifyAlgorithm,
    key,
    signatureForVerify,
    signingInput
  );
  if (!valid) {
    throw new Error('Invalid token signature');
  }

  validateJwtClaims(payload);
  return payload;
}

function getJwtAlgConfig(alg) {
  const map = {
    RS256: {
      importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      verifyAlgorithm: 'RSASSA-PKCS1-v1_5',
    },
    RS384: {
      importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
      verifyAlgorithm: 'RSASSA-PKCS1-v1_5',
    },
    RS512: {
      importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
      verifyAlgorithm: 'RSASSA-PKCS1-v1_5',
    },
    PS256: {
      importAlgorithm: { name: 'RSA-PSS', hash: 'SHA-256' },
      verifyAlgorithm: { name: 'RSA-PSS', saltLength: 32 },
    },
    PS384: {
      importAlgorithm: { name: 'RSA-PSS', hash: 'SHA-384' },
      verifyAlgorithm: { name: 'RSA-PSS', saltLength: 48 },
    },
    PS512: {
      importAlgorithm: { name: 'RSA-PSS', hash: 'SHA-512' },
      verifyAlgorithm: { name: 'RSA-PSS', saltLength: 64 },
    },
    ES256: {
      importAlgorithm: { name: 'ECDSA', namedCurve: 'P-256' },
      verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      joseToDer: true,
      josePartLength: 32,
    },
    ES384: {
      importAlgorithm: { name: 'ECDSA', namedCurve: 'P-384' },
      verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-384' },
      joseToDer: true,
      josePartLength: 48,
    },
    ES512: {
      importAlgorithm: { name: 'ECDSA', namedCurve: 'P-521' },
      verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-512' },
      joseToDer: true,
      josePartLength: 66,
    },
    EdDSA: {
      importAlgorithm: { name: 'Ed25519' },
      verifyAlgorithm: 'Ed25519',
    },
  };

  const config = map[alg];
  if (!config) {
    throw new Error(`Unsupported token algorithm: ${alg}`);
  }
  return config;
}

function trimLeadingZeroes(buf) {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i += 1;
  return buf.slice(i);
}

function encodeDerInteger(raw) {
  let value = trimLeadingZeroes(raw);
  if (value[0] & 0x80) {
    value = Buffer.concat([Buffer.from([0]), value]);
  }
  return Buffer.concat([Buffer.from([0x02, value.length]), value]);
}

function joseSignatureToDer(signature, partLength) {
  if (!(signature instanceof Buffer)) {
    signature = Buffer.from(signature);
  }
  if (signature.length !== partLength * 2) {
    throw new Error('Invalid ECDSA signature length');
  }
  const r = signature.subarray(0, partLength);
  const s = signature.subarray(partLength);
  const rDer = encodeDerInteger(r);
  const sDer = encodeDerInteger(s);
  const seqLen = rDer.length + sDer.length;
  return Buffer.concat([Buffer.from([0x30, seqLen]), rDer, sDer]);
}

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return '';
  }
  return authHeader.slice(7).trim();
}

async function requireAuth(req, res) {
  if (!getJwksUrl()) {
    sendJson(res, 500, { error: 'Auth not configured: missing NEON_AUTH_JWKS_URL' });
    return null;
  }

  const token = extractBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Unauthorized: missing bearer token' });
    return null;
  }

  try {
    const claims = await verifyJwt(token);
    return claims;
  } catch (err) {
    sendJson(res, 401, { error: `Unauthorized: ${err.message || 'invalid token'}` });
    return null;
  }
}

async function queueMessage(sql, { room, toClientId, type, fromClientId = null, payload = null, viewerId = null }) {
  await sql`
    INSERT INTO messages (room, to_client_id, type, from_client_id, payload, viewer_id)
    VALUES (${room}, ${toClientId}, ${type}, ${fromClientId}, ${payload}, ${viewerId})
  `;
}

async function touchClient(sql, { room, clientId }) {
  const rows = await sql`
    UPDATE clients
    SET last_seen = NOW()
    WHERE room = ${room} AND client_id = ${clientId}
    RETURNING client_id
  `;
  return rows.length > 0;
}

module.exports = {
  STALE_SECONDS,
  getSql,
  getNeonAuthBaseUrl,
  getJwksUrl,
  isActiveDate,
  parseJsonBody,
  sendJson,
  getRoomFromQuery,
  randomClientId,
  verifyJwt,
  extractBearerToken,
  requireAuth,
  queueMessage,
  touchClient,
};
