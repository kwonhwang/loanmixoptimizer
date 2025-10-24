// api/parse.js — Free-text → structured JSON with CORS + robust body parsing

function setCORS(res) {
  // Your site origin (scheme + host only; no trailing slash)
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
  if (req.method !== "POST") return res.status(405).json({ errors: ["Use POST"] });

  try {
    const body = await readJsonBody(req);
    const text = (body?.text ?? "").toString();
    if (!text.trim()) return res.status(400).json({ errors: ["Supply a non-empty 'text' string."] });

    const schemaHint = {
      target: 0,
      loans: [{ name: "", interestRate: 0, feePct: 0, cap: 0, termYears: 10, accrualMonths: 0 }],
      errors: []
    };

    const prompt = `
Extract ONLY a JSON object matching this exact schema:
${JSON.stringify(schemaHint, null, 2)}

Rules:
- Use numbers (not strings) for numeric fields.
- If a value is missing/ambiguous, set it to null and push a short note into "errors".
- Output ONLY JSON (no extra commentary).

Text:
"""${text}"""`.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.1-mini",
        input: prompt,
        response_format: { type: "json_object" }
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("OpenAI error", { status: r.status, data });
      return res.status(502).json({ errors: ["Upstream AI error. Check function logs."] });
    }

    const raw = data?.output?.[0]?.content?.[0]?.text ?? "{}";
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      console.error("JSON parse failed. Raw:", raw);
      return res.status(422).json({ errors: ["Invalid JSON from parser. Try a simpler sentence."] });
    }

    // Normalize shape & types
    const out = {
      target: Number(parsed?.target),
      loans: Array.isArray(parsed?.loans) ? parsed.loans.map(l => ({
        name: l?.name ?? "",
        interestRate: Number(l?.interestRate),
        feePct: Number(l?.feePct),
        cap: Number(l?.cap),
        termYears: Number(l?.termYears),
        accrualMonths: Number(l?.accrualMonths)
      })) : [],
      errors: Array.isArray(parsed?.errors) ? parsed.errors : []
    };

    return res.status(200).json(out);
  } catch (e) {
    console.error("parse handler error:", e);
    return res.status(500).json({ errors: [e.message || "Server error"] });
  }
}
