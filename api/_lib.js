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
  isActiveDate,
  parseJsonBody,
  sendJson,
  getRoomFromQuery,
  randomClientId,
  queueMessage,
  touchClient,
};
