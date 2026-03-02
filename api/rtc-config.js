const { sendJson } = require('./_lib');

async function getCloudflareIceServers() {
  const keyId = process.env.TURN_KEY_ID;
  const apiToken = process.env.TURN_KEY_API_TOKEN;
  if (!keyId || !apiToken) return null;

  const ttl = Number(process.env.TURN_TTL_SECONDS || 86400);
  const endpoint = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(
    keyId
  )}/credentials/generate-ice-servers`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudflare TURN error (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const direct = Array.isArray(data?.iceServers) ? data.iceServers : null;
  const wrapped = Array.isArray(data?.result?.iceServers) ? data.result.iceServers : null;
  const iceServers = direct || wrapped;

  if (!iceServers || !iceServers.length) {
    throw new Error('Cloudflare TURN returned no iceServers');
  }

  return iceServers;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  try {
    const cloudflareIceServers = await getCloudflareIceServers();
    if (cloudflareIceServers) {
      for (const server of cloudflareIceServers) {
        iceServers.push(server);
      }
      sendJson(res, 200, { iceServers });
      return;
    }
  } catch (err) {
    // Fallback below for local/manual TURN config.
    console.error(err.message);
  }

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }

  sendJson(res, 200, { iceServers });
};
