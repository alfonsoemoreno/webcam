const {
  STALE_SECONDS,
  fromScopedRoom,
  getRoomPrefix,
  getSql,
  getUserIdFromClaims,
  requireAuth,
  sendJson,
} = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
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
    const roomPrefix = getRoomPrefix(userId);

    const sql = getSql();
    const rows = await sql`
      SELECT
        ch.room,
        COALESCE(ch.camera_name, ch.room) AS name,
        COALESCE(v.viewers, 0)::int AS viewers
      FROM camera_hosts ch
      JOIN clients h ON h.client_id = ch.host_client_id
      LEFT JOIN (
        SELECT room, COUNT(*)::int AS viewers
        FROM clients
        WHERE role = 'viewer'
          AND last_seen > NOW() - make_interval(secs => ${STALE_SECONDS})
          AND room LIKE ${roomPrefix + '%'}
        GROUP BY room
      ) v ON v.room = ch.room
      WHERE h.last_seen > NOW() - make_interval(secs => ${STALE_SECONDS})
        AND ch.room LIKE ${roomPrefix + '%'}
      ORDER BY name ASC
    `;

    sendJson(res, 200, {
      cameras: rows.map((row) => ({
        room: fromScopedRoom(userId, row.room),
        name: row.name,
        viewers: row.viewers,
      })),
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
