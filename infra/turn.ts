// Cloudflare TURN credentials (set via fly secrets)
const TURN_KEY_ID = process.env.CLOUDFLARE_TURN_KEY_ID;
const TURN_API_TOKEN = process.env.CLOUDFLARE_TURN_API_TOKEN;

export async function getTurnCredentials(): Promise<Response> {
  if (!TURN_KEY_ID || !TURN_API_TOKEN) {
    console.warn("TURN credentials not configured");
    return Response.json({ error: "TURN not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TURN_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }), // 24 hours
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("TURN API error:", res.status, text);
      return Response.json(
        { error: "Failed to get TURN credentials" },
        { status: 502 },
      );
    }

    const data = await res.json();
    return Response.json(data, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "max-age=3600", // Cache for 1 hour
      },
    });
  } catch (e) {
    console.error("TURN fetch error:", e);
    return Response.json(
      { error: "Failed to fetch TURN credentials" },
      { status: 500 },
    );
  }
}
