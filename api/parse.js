// api/parse.js
// Turns messy text into structured fields: { target, loans: [...], errors: [...] }

function setCORS(res) {
  // TODO: set to your real GitHub Pages origin (scheme + host only)
  res.setHeader("Access-Control-Allow-Origin", "https://kwonhwang.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") {
    // CORS preflight
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ errors: ["Method not allowed. Use POST."] });
  }

  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ errors: ["Supply a non-empty 'text' string."] });
    }

    // The shape we want back from the model
    const schemaHint = {
      target: 0,
      loans: [
        {
          name: "",
          interestRate: 0,
          feePct: 0,
          cap: 0,
          termYears: 10,
          accrualMonths: 0
        }
      ],
      errors: []
    };

    // Compact, strict prompt for JSON-only
    const prompt = `
Extract ONLY a JSON object matching this exact schema:
${JSON.stringify(schemaHint, null, 2)}

Rules:
- Use numbers (not strings) for numeric fields.
- If a value is missing/ambiguous, set it to null and push a short note into "errors".
- Output ONLY JSON. No extra commentary.

Text:
"""${text}"""
    `.trim();

    // Call OpenAI
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
      // Log full error to Vercel function logs; return a generic message to client
      console.error("OpenAI error", { status: r.status, data });
      return res.status(502).json({ errors: ["Upstream AI error. Check function logs."] });
    }

    // The JSON string returned by json mode is at this path:
    const raw = data?.output?.[0]?.content?.[0]?.text ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("JSON parse failed. Raw:", raw);
      return res.status(422).json({ errors: ["Invalid JSON from parser. Try simplifying your text."] });
    }

    // Final safety defaults
    if (typeof parsed !== "object" || parsed === null) parsed = {};
    if (!Array.isArray(parsed.loans)) parsed.loans = [];
    if (!Array.isArray(parsed.errors)) parsed.errors = [];

    return res.status(200).json(parsed);

  } catch (e) {
    console.error("parse handler error:", e);
    return res.status(500).json({ errors: [e.message || "Server error."] });
  }
}
