// api/explain.js — Allocation → concise explanation (with CORS)

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://kwonhwang.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readJsonBody(req) {
  try {
    if (req.body && typeof req.body === "object") return req.body;
    if (req.body && typeof req.body === "string") return JSON.parse(req.body);
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const body = await readJsonBody(req);
    const { target, allocation, blendedCPD, feasible, shortfall } = body || {};

    const system = `You are a neutral financial explainer for education loans.
Write 4–6 concise bullet points. Be precise, avoid personal advice.
Cover: ordering rationale (interest rate, fees, caps, term), blended cost-per-dollar, key trade-offs, and one common what-if.`;
    const user = JSON.stringify({ target, allocation, blendedCPD, feasible, shortfall });

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.1-mini",
        input: [{ role: "system", content: system }, { role: "user", content: user }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("OpenAI error", { status: r.status, data });
      return res.status(502).json({ error: "Upstream AI error. Check function logs." });
    }

    const text = data?.output?.[0]?.content?.[0]?.text ?? "No explanation available.";
    return res.status(200).json({ explanation: text });
  } catch (e) {
    console.error("explain handler error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
