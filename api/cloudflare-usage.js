const { requireAuth, sendJson } = require('./_lib');

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const FREE_TIER_GB = 1000;

function getMonthRangeUtc(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1) - 1);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function bytesToGb(bytes) {
  return Number((bytes / (1024 ** 3)).toFixed(3));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const session = await requireAuth(req, res);
    if (!session) return;

    const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
    if (!accountId || !apiToken) {
      sendJson(res, 500, {
        error: 'Missing Cloudflare config: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN',
      });
      return;
    }

    const { from, to } = getMonthRangeUtc();
    const query = `
      query TurnMonthlyUsage($accountId: String!, $dateFrom: Date!, $dateTo: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountId }) {
            callsTurnUsageAdaptiveGroups(
              filter: { date_geq: $dateFrom, date_leq: $dateTo }
              limit: 10000
            ) {
              sum {
                egressBytes
                ingressBytes
              }
            }
          }
        }
      }
    `;

    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          accountId,
          dateFrom: from,
          dateTo: to,
        },
      }),
    });

    const payload = await response.json();
    if (!response.ok || payload.errors) {
      sendJson(res, 502, {
        error: 'Cloudflare GraphQL error',
        details: payload.errors || payload,
      });
      return;
    }

    const groups = payload?.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups || [];
    let egressBytes = 0;
    let ingressBytes = 0;

    for (const group of groups) {
      egressBytes += Number(group?.sum?.egressBytes || 0);
      ingressBytes += Number(group?.sum?.ingressBytes || 0);
    }

    const egressGb = bytesToGb(egressBytes);
    const ingressGb = bytesToGb(ingressBytes);
    const usagePercent = Number(Math.min(100, (egressGb / FREE_TIER_GB) * 100).toFixed(2));
    const remainingGb = Number(Math.max(0, FREE_TIER_GB - egressGb).toFixed(3));

    sendJson(res, 200, {
      period: { from, to, timezone: 'UTC' },
      freeTierGb: FREE_TIER_GB,
      egressBytes,
      ingressBytes,
      egressGb,
      ingressGb,
      usagePercent,
      remainingGb,
      estimatedOverageGb: Number(Math.max(0, egressGb - FREE_TIER_GB).toFixed(3)),
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
