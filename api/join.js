const {
  STALE_SECONDS,
  getSql,
  isActiveDate,
  parseJsonBody,
  randomClientId,
  queueMessage,
  sendJson,
} = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const sql = getSql();
    const { room: roomRaw, role, cameraName: cameraNameRaw } = await parseJsonBody(req);
    const room = String(roomRaw || 'main').trim() || 'main';

    if (!['host', 'viewer'].includes(role)) {
      sendJson(res, 400, { error: 'Invalid role' });
      return;
    }

    const cameraRows = await sql`
      SELECT ch.host_client_id, ch.camera_name, c.last_seen
      FROM camera_hosts ch
      LEFT JOIN clients c ON c.client_id = ch.host_client_id
      WHERE ch.room = ${room}
      LIMIT 1
    `;
    const camera = cameraRows[0] || null;
    const activeHostId = camera && isActiveDate(camera.last_seen) ? camera.host_client_id : null;

    if (role === 'host' && activeHostId) {
      sendJson(res, 409, { error: 'Room already has a host' });
      return;
    }

    const clientId = randomClientId();
    await sql`
      INSERT INTO clients (client_id, room, role)
      VALUES (${clientId}, ${room}, ${role})
    `;

    const cameraName = String(cameraNameRaw || camera?.camera_name || room).trim() || room;

    if (role === 'host') {
      await sql`
        INSERT INTO camera_hosts (room, camera_name, host_client_id, updated_at)
        VALUES (${room}, ${cameraName}, ${clientId}, NOW())
        ON CONFLICT (room)
        DO UPDATE SET
          camera_name = EXCLUDED.camera_name,
          host_client_id = EXCLUDED.host_client_id,
          updated_at = NOW()
      `;

      const viewers = await sql`
        SELECT client_id
        FROM clients
        WHERE room = ${room}
          AND role = 'viewer'
          AND client_id <> ${clientId}
          AND last_seen > NOW() - make_interval(secs => ${STALE_SECONDS})
      `;

      for (const viewer of viewers) {
        await queueMessage(sql, {
          room,
          toClientId: clientId,
          type: 'viewer-joined',
          viewerId: viewer.client_id,
        });
      }

      sendJson(res, 200, {
        clientId,
        room,
        role,
        cameraName,
        hasHost: true,
      });
      return;
    }

    if (activeHostId) {
      await queueMessage(sql, {
        room,
        toClientId: activeHostId,
        type: 'viewer-joined',
        viewerId: clientId,
      });
    }

    sendJson(res, 200, {
      clientId,
      room,
      role,
      cameraName,
      hasHost: Boolean(activeHostId),
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
