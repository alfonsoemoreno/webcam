const {
  assertTransmissionAllowed,
  getSql,
  getUserIdFromClaims,
  parseJsonBody,
  queueMessage,
  requireAuth,
  sendJson,
  toScopedRoom,
  touchClient,
} = require('./_lib');

const ALLOWED_TYPES = new Set(['offer', 'answer', 'ice']);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const session = await requireAuth(req, res);
    if (!session) return;
    const userId = getUserIdFromClaims(session);
    if (!userId) {
      sendJson(res, 401, { error: 'Unauthorized: missing user id in token' });
      return;
    }

    const transmissionAllowed = await assertTransmissionAllowed(res);
    if (!transmissionAllowed) return;

    const sql = getSql();
    const { room: roomRaw, from, to, type, payload } = await parseJsonBody(req);
    const publicRoom = String(roomRaw || 'main').trim() || 'main';
    const room = toScopedRoom(userId, publicRoom);
    const fromClientId = String(from || '').trim();
    const toClientId = String(to || '').trim();

    if (!fromClientId || !toClientId) {
      sendJson(res, 400, { error: 'Missing sender/target' });
      return;
    }
    if (!ALLOWED_TYPES.has(type)) {
      sendJson(res, 400, { error: 'Invalid message type' });
      return;
    }

    const senderExists = await touchClient(sql, { room, clientId: fromClientId });
    if (!senderExists) {
      sendJson(res, 404, { error: 'Sender not found' });
      return;
    }

    const targetRows = await sql`
      SELECT client_id
      FROM clients
      WHERE room = ${room} AND client_id = ${toClientId}
      LIMIT 1
    `;
    if (!targetRows.length) {
      sendJson(res, 404, { error: 'Target not found' });
      return;
    }

    await queueMessage(sql, {
      room,
      toClientId,
      type,
      fromClientId,
      payload: payload || null,
    });

    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
