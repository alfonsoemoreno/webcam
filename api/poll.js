const {
  getSql,
  getRoomFromQuery,
  requireAuth,
  sendJson,
  touchClient,
} = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const session = await requireAuth(req, res);
    if (!session) return;

    const sql = getSql();
    const room = getRoomFromQuery(req);
    const clientId = String(req.query.clientId || '').trim();

    if (!clientId) {
      sendJson(res, 400, { error: 'Missing clientId' });
      return;
    }

    const exists = await touchClient(sql, { room, clientId });
    if (!exists) {
      sendJson(res, 404, { error: 'Client not found' });
      return;
    }

    const rows = await sql`
      WITH picked AS (
        SELECT id, type, from_client_id, payload, viewer_id
        FROM messages
        WHERE room = ${room} AND to_client_id = ${clientId}
        ORDER BY id
        LIMIT 200
      ),
      deleted AS (
        DELETE FROM messages
        WHERE id IN (SELECT id FROM picked)
        RETURNING id
      )
      SELECT type, from_client_id, payload, viewer_id
      FROM picked
      ORDER BY id
    `;

    const messages = rows.map((row) => ({
      type: row.type,
      from: row.from_client_id || undefined,
      payload: row.payload || undefined,
      viewerId: row.viewer_id || undefined,
    }));

    sendJson(res, 200, { messages });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
