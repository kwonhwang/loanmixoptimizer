const $ = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>[...root.querySelectorAll(sel)];

// Use your Vercel domain (no trailing slash)
const API_BASE = "https://loanmixoptimizer-git-main-kwon-hwangs-projects.vercel.app";

// ---------- Front-end calls to API ----------
async function parseFreeTextAndFill() {
  const raw = $('#free-text').value || "";
  if (!raw.trim()) { alert("Paste some text first."); return; }

  try {
    const res = await fetch(`${API_BASE}/api/parse`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ text: raw })
    });
    const data = await res.json();
    console.log("Parse response:", data);

    if (data.errors?.length) {
      alert("Parser notes:\n- " + data.errors.join("\n- "));
    }

    // 1) Target amount (coerce to number)
    const targetNum = Number(data.target);
    if (Number.isFinite(targetNum)) {
      $('#target-amount').value = targetNum;
    }

    // 2) Ensure enough rows exist
    const nLoans = Array.isArray(data.loans) ? data.loans.length : 0;
    const existing = $$('.loan').length;
    for (let i = 0; i < nLoans - existing; i++) $('#add-loan').click();

    // 3) Fill rows safely
    const rows = $$('.loan');
    (data.loans || []).forEach((l, i) => {
      const row = rows[i];
      if (!row) return;
      $('.loan-name', row).value       = l?.name ?? "";
      $('.loan-interest', row).value   = Number(l?.interestRate ?? "") || "";
      $('.loan-fee', row).value        = Number(l?.feePct ?? "") || "";
      $('.loan-cap', row).value        = Number(l?.cap ?? "") || "";
      $('.loan-term', row).value       = Number(l?.termYears ?? "") || "";
      $('.loan-accrual', row).value    = Number(l?.accrualMonths ?? "") || "";
    });

    // Focus the optimize button to guide the next action
    $('#optimize').focus();

  } catch (e) {
    console.error("Parse error:", e);
    alert("Network/server error while parsing. Check API_BASE URL and CORS on your Vercel function.");
  }
}

async function requestExplanation(payload) {
  try {
    const res = await fetch(`${API_BASE}/api/explain`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log("Explain response:", data);

    const card = $('#explain');
    const p = $('#explanation-text');
    card.hidden = false;
    p.textContent = data.explanation || "Explanation unavailable right now.";
  } catch (e) {
    console.error("Explain error:", e);
    const card = $('#explain');
    const p = $('#explanation-text');
    card.hidden = false;
    p.textContent = "Explanation unavailable right now (network/server error).";
  }
}

// ---------- UI helpers & optimization ----------
function addLoanRow() {
  const t = $('#loan-row').content.cloneNode(true);
  t.querySelector('.remove-loan').addEventListener('click', e => {
    e.currentTarget.closest('.loan').remove();
  });
  $('#loans').appendChild(t);
}

// Cost-per-dollar (simplified heuristic): dollars repaid per $1 borrowed
function costPerDollar({interestRate, feePct, accrualMonths, termYears}) {
  const rate = (interestRate || 0) / 100;
  const fee = (feePct || 0) / 100;
  const term = Math.max(1, termYears || 10);
  const months = Math.max(0, accrualMonths || 0);

  const principal_effective = 1 + fee;               // adds origination fee
  const in_school_interest = rate * (months/12);     // simple accrual during school
  const amortization_interest_factor = rate * term * 0.55; // amortization approximation

  return principal_effective * (1 + in_school_interest) * (1 + amortization_interest_factor);
}

function readLoans() {
  return $$('.loan').map((el, i) => ({
    id: i+1,
    name: $('.loan-name', el)?.value?.trim() || `Loan ${i+1}`,
    interestRate: parseFloat($('.loan-interest', el)?.value || '0'),
    feePct: parseFloat($('.loan-fee', el)?.value || '0'),
    cap: parseFloat($('.loan-cap', el)?.value || '0'),
    termYears: parseFloat($('.loan-term', el)?.value || '10'),
    accrualMonths: parseFloat($('.loan-accrual', el)?.value || '0'),
  })).filter(x => !Number.isNaN(x.cap) && x.cap > 0);
}

function optimize() {
  const target = parseFloat($('#target-amount').value || '0');
  if (!target || target <= 0) {
    alert('Enter a target amount to finance.');
    return;
  }
  const loans = readLoans();
  if (loans.length === 0) {
    alert('Add at least one loan option.');
    return;
  }

  // Greedy heuristic: allocate cheapest first by cost-per-dollar
  loans.forEach(l => l.cpd = costPerDollar(l));
  loans.sort((a,b)=> a.cpd - b.cpd);

  let need = target;
  const allocation = [];
  for (const l of loans) {
    if (need <= 0) break;
    const use = Math.min(l.cap, need);
    allocation.push({...l, used: use});
    need -= use;
  }

  renderResults(allocation, target, need <= 0, Math.max(0, need));
}

function renderResults(allocation, target, feasible, shortfall) {
  $('#results').hidden = false;

  const totalBorrowed = allocation.reduce((s,x)=>s + (x.used||0), 0);
  const totalCost = allocation.reduce((s,x)=> s + (x.used * x.cpd), 0);
  const blendedCPD = totalBorrowed ? (totalCost / totalBorrowed) : 0;

  const rows = allocation.map(x => `
    <tr>
      <td>${x.name}</td>
      <td>${x.used.toFixed(2)}</td>
      <td>${x.interestRate.toFixed(2)}%</td>
      <td>${x.feePct.toFixed(3)}%</td>
      <td>${x.termYears} yrs</td>
      <td>${x.accrualMonths} mo</td>
      <td>${x.cpd.toFixed(3)}×</td>
    </tr>
  `).join('');

  $('#allocation-table').innerHTML = `
    <table aria-describedby="allocation-summary">
      <thead>
        <tr>
          <th>Loan</th><th>Amount ($)</th><th>Interest Rate</th><th>Orig Fee</th>
          <th>Term</th><th>In-School</th><th>Cost per $</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  $('#summary').innerHTML = `
    <p id="allocation-summary">
      ${feasible
        ? `Total borrowed: <strong>$${totalBorrowed.toFixed(2)}</strong> (meets target $${target.toFixed(2)}).`
        : `You’re <strong>$${shortfall.toFixed(2)}</strong> short of the $${target.toFixed(2)} target given current caps.`}
    </p>
    <p>Estimated dollars repaid per $1 borrowed (blended): <strong>${blendedCPD.toFixed(3)}×</strong>.</p>
    <p class="muted">Note: This MVP uses a simplified cost model and greedy allocation.</p>
  `;

  // Enable "Explain this plan" now that results exist
  $('#btn-explain').disabled = false;
}

// ---------- Wire up buttons after DOM is ready ----------
document.addEventListener('DOMContentLoaded', () => {
  // Seed two example loans
  addLoanRow(); addLoanRow();
  const [l1, l2] = $$('.loan');
  if (l1) {
    $('.loan-name', l1).value = 'Direct Subsidized';
    $('.loan-interest', l1).value = '6.53';
    $('.loan-fee', l1).value = '1.057';
    $('.loan-cap', l1).value = '5500';
    $('.loan-term', l1).value = '10';
    $('.loan-accrual', l1).value = '0';
  }
  if (l2) {
    $('.loan-name', l2).value = 'Direct Unsubsidized';
    $('.loan-interest', l2).value = '8.08';
    $('.loan-fee', l2).value = '1.057';
    $('.loan-cap', l2).value = '12000';
    $('.loan-term', l2).value = '10';
    $('.loan-accrual', l2).value = '24';
  }

  // Buttons
  $('#add-loan').addEventListener('click', addLoanRow);
  $('#optimize').addEventListener('click', optimize);
  $('#btn-parse').addEventListener('click', parseFreeTextAndFill);

  // Explain button: collect rendered results and send for explanation
  $('#btn-explain').addEventListener('click', async () => {
    const target = parseFloat($('#target-amount').value || '0');

    // Read current table to construct payload
    const allocation = [...document.querySelectorAll('#allocation-table tbody tr')].map(tr => {
      const tds = tr.querySelectorAll('td');
      return {
        name: tds[0]?.textContent?.trim() || "",
        used: parseFloat(tds[1]?.textContent || "0"),
        cpd: parseFloat((tds[6]?.textContent || "0").replace('×',''))
      };
    });

    const summaryText = $('#summary')?.textContent || "";
    const blendedMatch = summaryText.match(/Blended.*?([\d.]+)×/i);
    const blendedCPD = blendedMatch ? parseFloat(blendedMatch[1]) : 0;

    const feasible = !/Shortfall:/i.test(summaryText);
    const shortfallMatch = summaryText.match(/Shortfall:\s*\$([\d,.]+)/i);
    const shortfall = shortfallMatch ? parseFloat(shortfallMatch[1].replace(/[,]/g,'')) : 0;

    await requestExplanation({ target, allocation, blendedCPD, feasible, shortfall });
  });
});
