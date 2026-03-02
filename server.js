const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const rooms = new Map();
let nextId = 1;

function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      hostId: null,
      cameraName: roomName,
      clients: new Map(),
    });
  }
  return rooms.get(roomName);
}

function queueMessage(roomName, toClientId, message) {
  const room = rooms.get(roomName);
  if (!room) return false;
  const target = room.clients.get(toClientId);
  if (!target) return false;
  target.queue.push(message);
  return true;
}

function createClient(role) {
  const id = String(nextId++);
  return { id, role, queue: [] };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };

    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function cleanupClient(roomName, clientId) {
  const room = rooms.get(roomName);
  if (!room) return;

  const client = room.clients.get(clientId);
  if (!client) return;

  room.clients.delete(clientId);
  if (client.role === 'host' && room.hostId === clientId) {
    room.hostId = null;
    for (const viewer of room.clients.values()) {
      viewer.queue.push({ type: 'host-left' });
    }
  } else if (room.hostId) {
    queueMessage(roomName, room.hostId, {
      type: 'viewer-left',
      viewerId: clientId,
    });
  }

  if (room.clients.size === 0) {
    rooms.delete(roomName);
  }
}

function getLocalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function getPublicIp() {
  return new Promise((resolve) => {
    const req = https.get('https://api64.ipify.org?format=json', (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.ip || null);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(3500, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function listActiveCameras() {
  const cameras = [];
  for (const [roomName, room] of rooms.entries()) {
    if (!room.hostId) continue;
    let viewers = 0;
    for (const client of room.clients.values()) {
      if (client.role === 'viewer') viewers += 1;
    }
    cameras.push({
      room: roomName,
      name: room.cameraName || roomName,
      viewers,
    });
  }
  cameras.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return cameras;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  try {
    if (req.method === 'POST' && pathname === '/api/join') {
      const { room: roomNameRaw, role, cameraName: cameraNameRaw } = await parseBody(req);
      const roomName = (roomNameRaw || 'main').trim();
      if (!['host', 'viewer'].includes(role)) {
        sendJson(res, 400, { error: 'Invalid role' });
        return;
      }

      const room = getRoom(roomName);
      if (role === 'host' && room.hostId) {
        sendJson(res, 409, { error: 'Room already has a host' });
        return;
      }

      const client = createClient(role);
      room.clients.set(client.id, client);

      if (role === 'host') {
        room.hostId = client.id;
        room.cameraName = String(cameraNameRaw || roomName).trim() || roomName;
        for (const viewer of room.clients.values()) {
          if (viewer.role === 'viewer') {
            queueMessage(roomName, client.id, {
              type: 'viewer-joined',
              viewerId: viewer.id,
            });
          }
        }
      } else if (room.hostId) {
        queueMessage(roomName, room.hostId, {
          type: 'viewer-joined',
          viewerId: client.id,
        });
      }

      sendJson(res, 200, {
        clientId: client.id,
        room: roomName,
        role,
        cameraName: room.cameraName || roomName,
        hasHost: Boolean(room.hostId),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/cameras') {
      sendJson(res, 200, {
        cameras: listActiveCameras(),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/poll') {
      const roomName = (requestUrl.searchParams.get('room') || 'main').trim();
      const clientId = requestUrl.searchParams.get('clientId');
      if (!clientId) {
        sendJson(res, 400, { error: 'Missing clientId' });
        return;
      }

      const room = rooms.get(roomName);
      const client = room && room.clients.get(clientId);
      if (!client) {
        sendJson(res, 404, { error: 'Client not found' });
        return;
      }

      const messages = client.queue.splice(0, client.queue.length);
      sendJson(res, 200, { messages });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/send') {
      const { room: roomNameRaw, from, to, type, payload } = await parseBody(req);
      const roomName = (roomNameRaw || 'main').trim();
      const room = rooms.get(roomName);
      if (!room) {
        sendJson(res, 404, { error: 'Room not found' });
        return;
      }
      if (!room.clients.has(from)) {
        sendJson(res, 404, { error: 'Sender not found' });
        return;
      }
      if (!['offer', 'answer', 'ice'].includes(type)) {
        sendJson(res, 400, { error: 'Invalid message type' });
        return;
      }
      const ok = queueMessage(roomName, to, { type, from, payload });
      if (!ok) {
        sendJson(res, 404, { error: 'Target not found' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/leave') {
      const { room: roomNameRaw, clientId } = await parseBody(req);
      const roomName = (roomNameRaw || 'main').trim();
      if (!clientId) {
        sendJson(res, 400, { error: 'Missing clientId' });
        return;
      }
      cleanupClient(roomName, clientId);
      sendJson(res, 200, { ok: true });
      return;
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, HOST, async () => {
  const localIps = getLocalIps();
  const localBase = `http://localhost:${PORT}`;
  const publicIp = await getPublicIp();

  console.log('\nWebcam security app running');
  console.log(`Host panel (en este computador): ${localBase}/host.html`);
  console.log(`Viewer panel local (seleccion de camaras): ${localBase}/viewer.html`);

  if (localIps.length) {
    for (const ip of localIps) {
      console.log(`Viewer desde tu red local: http://${ip}:${PORT}/viewer.html`);
    }
  }

  if (publicIp) {
    console.log(`\nIP publica detectada: ${publicIp}`);
    console.log(`URL publica esperada: http://${publicIp}:${PORT}/viewer.html`);
    console.log('Nota: Para acceso externo real necesitas redirigir el puerto en tu router o usar un tunel/VPN.');
  } else {
    console.log('\nNo pude detectar la IP publica automaticamente (bloqueo de red o DNS).');
  }

  console.log('');
});
