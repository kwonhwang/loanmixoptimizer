// api/parse.js — Free-text → structured JSON with CORS + robust body parsing

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

    const system = `
You convert messy user text about loans into a strict JSON object.
Return ONLY a JSON object that matches this schema (no extra keys, no commentary):
${JSON.stringify(schemaHint, null, 2)}

Rules:
- Use numbers (not strings) for numeric fields.
- If a value is missing/ambiguous, set it to null and add a short message to "errors".
`.trim();

    const user = `Text:\n"""${text}"""`;

    // Use Chat Completions with JSON mode
    const MODEL = "gpt-4o-mini";
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("OpenAI error", { status: r.status, data });
      const msg = data?.error?.message || JSON.stringify(data);
      return res.status(502).json({
        errors: ["Upstream AI error.", `status=${r.status}`, `detail=${(msg || "").slice(0,300)}`]
      });
    }

    // JSON mode returns JSON string in message.content
    const raw = data?.choices?.[0]?.message?.content ?? "{}";

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
