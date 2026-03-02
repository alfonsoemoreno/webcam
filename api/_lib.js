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

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function copyResponseHeaders(sourceHeaders, res) {
  const contentType = sourceHeaders.get('content-type');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
  const setCookies = extractSetCookies(sourceHeaders);
  if (setCookies.length) {
    res.setHeader('Set-Cookie', setCookies);
  }
}

async function callNeonAuth({ req, method, path, body = null }) {
  const baseUrl = getNeonAuthBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      status: 500,
      json: { error: 'Missing NEON_AUTH_BASE_URL env var' },
      headers: new Headers(),
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (req.headers.cookie) {
    headers.Cookie = req.headers.cookie;
  }
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json;
  try {
    json = await response.json();
  } catch {
    json = { error: 'Invalid response from auth provider' };
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    headers: response.headers,
  };
}

async function getSessionFromNeon(req) {
  const attempts = ['/get-session', '/session'];
  let last = null;

  for (const path of attempts) {
    const result = await callNeonAuth({ req, method: 'GET', path });
    last = result;
    if (result.ok || result.status !== 404) {
      break;
    }
  }

  const payload = last?.json || {};
  const session = payload?.data || payload?.session || null;
  return {
    ok: Boolean(last?.ok && session && session.user),
    status: last?.status || 500,
    session,
    raw: payload,
  };
}

async function requireAuth(req, res) {
  if (!getNeonAuthBaseUrl()) {
    sendJson(res, 500, { error: 'Auth not configured: missing NEON_AUTH_BASE_URL' });
    return null;
  }
  const sessionResult = await getSessionFromNeon(req);
  if (!sessionResult.ok) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return sessionResult.session;
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
  isActiveDate,
  parseJsonBody,
  sendJson,
  getRoomFromQuery,
  randomClientId,
  callNeonAuth,
  copyResponseHeaders,
  getSessionFromNeon,
  requireAuth,
  queueMessage,
  touchClient,
};
