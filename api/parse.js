// turns messy text into structured fields by returning clean fields (target amount, each loan's details)

// api/parse.js
export default async function handler(req, res) {
  try {
    const { text } = req.body || {};
    const schemaHint = {
      target: 0,
      loans: [{
        name: "", interestRate: 0, feePct: 0, cap: 0, termYears: 10, accrualMonths: 0
      }],
      errors: []
    };

    const prompt = `
