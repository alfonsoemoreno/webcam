CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('host', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_room_role ON clients(room, role);
CREATE INDEX IF NOT EXISTS idx_clients_last_seen ON clients(last_seen);

CREATE TABLE IF NOT EXISTS camera_hosts (
  room TEXT PRIMARY KEY,
  camera_name TEXT NOT NULL,
  host_client_id TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_camera_hosts_host ON camera_hosts(host_client_id);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  room TEXT NOT NULL,
  to_client_id TEXT NOT NULL,
  type TEXT NOT NULL,
  from_client_id TEXT NULL,
  payload JSONB NULL,
  viewer_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_target ON messages(room, to_client_id, id);
