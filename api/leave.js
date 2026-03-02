const {
  STALE_SECONDS,
  getSql,
  getUserIdFromClaims,
  parseJsonBody,
  queueMessage,
  requireAuth,
  sendJson,
  toScopedRoom,
} = require('./_lib');

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

    const sql = getSql();
    const { room: roomRaw, clientId: clientIdRaw } = await parseJsonBody(req);
    const publicRoom = String(roomRaw || 'main').trim() || 'main';
    const room = toScopedRoom(userId, publicRoom);
    const clientId = String(clientIdRaw || '').trim();

    if (!clientId) {
      sendJson(res, 400, { error: 'Missing clientId' });
      return;
    }

    const rows = await sql`
      DELETE FROM clients
      WHERE room = ${room} AND client_id = ${clientId}
      RETURNING role
    `;

    if (!rows.length) {
      sendJson(res, 200, { ok: true });
      return;
    }

    const role = rows[0].role;

    if (role === 'host') {
      await sql`
        UPDATE camera_hosts
        SET host_client_id = NULL, updated_at = NOW()
        WHERE room = ${room} AND host_client_id = ${clientId}
      `;

      const viewers = await sql`
        SELECT client_id
        FROM clients
        WHERE room = ${room}
          AND role = 'viewer'
          AND last_seen > NOW() - make_interval(secs => ${STALE_SECONDS})
      `;

      for (const viewer of viewers) {
        await queueMessage(sql, {
          room,
          toClientId: viewer.client_id,
          type: 'host-left',
        });
      }
    } else {
      const hostRows = await sql`
        SELECT ch.host_client_id
        FROM camera_hosts ch
        JOIN clients c ON c.client_id = ch.host_client_id
        WHERE ch.room = ${room}
          AND c.last_seen > NOW() - make_interval(secs => ${STALE_SECONDS})
        LIMIT 1
      `;

      if (hostRows.length) {
        await queueMessage(sql, {
          room,
          toClientId: hostRows[0].host_client_id,
          type: 'viewer-left',
          viewerId: clientId,
        });
      }
    }

    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
