// writes a short summary after loan optimization is computed

// api/explain.js
export default async function handler(req, res) {
  try {
    const { target, allocation, blendedCPD, feasible, shortfall } = req.body || {};
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
    const text = data?.output?.[0]?.content?.[0]?.text ?? "No explanation available.";
    return res.status(200).json({ explanation: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
