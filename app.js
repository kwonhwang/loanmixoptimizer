// app.js
const API_BASE = "https://loanmixoptimizer.kwonhwan.workers.dev"; 

// --- DOM helpers ---
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ------------------------------------
// Add / remove loan rows
// ------------------------------------
function addLoanRow(prefill = {}) {
  const template = $("#loan-row");
  const loansContainer = $("#loans");
  const clone = template.content.cloneNode(true);
  const fieldset = clone.querySelector("fieldset.loan");

  const nameInput = fieldset.querySelector(".loan-name");
  const interestInput = fieldset.querySelector(".loan-interest");
  const feeInput = fieldset.querySelector(".loan-fee");
  const capInput = fieldset.querySelector(".loan-cap");
  const termInput = fieldset.querySelector(".loan-term");
  const accrualInput = fieldset.querySelector(".loan-accrual");

  if (prefill.name) nameInput.value = prefill.name;
  if (prefill.interestRatePercent != null)
    interestInput.value = prefill.interestRatePercent;
  if (prefill.originationFeePercent != null)
    feeInput.value = prefill.originationFeePercent;
  if (prefill.borrowingCap != null) capInput.value = prefill.borrowingCap;
  if (prefill.repaymentTermYears != null)
    termInput.value = prefill.repaymentTermYears;
  if (prefill.inSchoolMonths != null)
    accrualInput.value = prefill.inSchoolMonths;

  const removeBtn = fieldset.querySelector(".remove-loan");
  removeBtn.addEventListener("click", () => fieldset.remove());

  loansContainer.appendChild(clone);
}

// ------------------------------------
// Read loans from form
// ------------------------------------
function readLoansFromForm() {
  const loansContainer = $("#loans");
  const loanFieldsets = loansContainer.querySelectorAll("fieldset.loan");
  const loans = [];
  loanFieldsets.forEach((fs) => {
    const name = fs.querySelector(".loan-name").value.trim();
    const interestRatePercent = parseFloat(
      fs.querySelector(".loan-interest").value || "0"
    );
    const originationFeePercent = parseFloat(
      fs.querySelector(".loan-fee").value || "0"
    );
    const borrowingCap = parseFloat(
      fs.querySelector(".loan-cap").value || "0"
    );
    const repaymentTermYears = parseFloat(
      fs.querySelector(".loan-term").value || "0"
    );
    const inSchoolMonths = parseFloat(
      fs.querySelector(".loan-accrual").value || "0"
    );

    loans.push({
      name: name || "Loan",
      interestRatePercent: isNaN(interestRatePercent)
        ? 0
        : interestRatePercent,
      originationFeePercent: isNaN(originationFeePercent)
        ? 0
        : originationFeePercent,
      borrowingCap:
        isNaN(borrowingCap) || borrowingCap <= 0 ? null : borrowingCap,
      repaymentTermYears:
        isNaN(repaymentTermYears) || repaymentTermYears <= 0
          ? null
          : repaymentTermYears,
      inSchoolMonths:
        isNaN(inSchoolMonths) || inSchoolMonths < 0 ? null : inSchoolMonths,
    });
  });
  return loans;
}

// ------------------------------------
// Optimization: allocate lowest-APR loans first
// BUT we treat targetAmount as NET cash needed.
// Origination fee is assumed to be charged up-front.
// netFromLoan = principal * (1 - feeRate)
// ------------------------------------
function optimizeMix(targetAmount, loans) {
  // Sort by interest rate (cheapest first)
  const sorted = [...loans].sort(
    (a, b) => (a.interestRatePercent || 0) - (b.interestRatePercent || 0)
  );

  let remainingNet = targetAmount;
  const allocation = [];

  for (const loan of sorted) {
    if (remainingNet <= 0) break;

    const feeRate = (loan.originationFeePercent || 0) / 100;
    const capPrincipal = loan.borrowingCap ?? Infinity;

    // Max net cash this loan can provide if we use full cap
    const maxNetFromLoan =
      feeRate < 1 ? capPrincipal * (1 - feeRate) : 0; // avoid division by zero

    if (maxNetFromLoan <= 0) continue;

    const netUsed = Math.min(remainingNet, maxNetFromLoan);
    const principalUsed =
      feeRate < 1 ? netUsed / (1 - feeRate) : 0; // invert net = P(1-fee)

    if (principalUsed <= 0) continue;

    allocation.push({
      loan,
      principal: principalUsed,
    });

    remainingNet -= netUsed;
  }

  return {
    targetNetNeeded: targetAmount,
    allocation,
    remainingNet: Math.max(0, remainingNet),
  };
}

// ------------------------------------
// Loan stats using term & in-school accrual
// ------------------------------------
function computeLoanStats(entry) {
  const { loan, principal } = entry;
  const rate = (loan.interestRatePercent || 0) / 100;
  const feeRate = (loan.originationFeePercent || 0) / 100;
  const termYears = loan.repaymentTermYears || 10; // default 10 years
  const inSchoolMonths = loan.inSchoolMonths || 0;

  // Origination fee (assumed upfront, not capitalized)
  const origFee = principal * feeRate;
  const netToUser = principal - origFee;

  // In-school interest: simple interest on principal
  const inSchoolInterest = principal * rate * (inSchoolMonths / 12);

  // Capitalized principal at start of repayment
  const capitalizedPrincipal = principal + inSchoolInterest;

  // Amortization: standard fixed-rate loan
  const monthlyRate = rate / 12;
  const nMonths = termYears * 12;
  let monthlyPayment;
  if (monthlyRate > 0) {
    const denom = 1 - Math.pow(1 + monthlyRate, -nMonths);
    monthlyPayment =
      denom > 0
        ? (capitalizedPrincipal * monthlyRate) / denom
        : capitalizedPrincipal / nMonths;
  } else {
    monthlyPayment = capitalizedPrincipal / nMonths;
  }

  const totalRepaid = monthlyPayment * nMonths;
  const totalInterest = totalRepaid - principal; // includes in-school + repayment interest

  return {
    name: loan.name,
    interestRatePercent: loan.interestRatePercent,
    principal,
    origFee,
    netToUser,
    inSchoolInterest,
    capitalizedPrincipal,
    monthlyPayment,
    totalRepaid,
    totalInterest,
    termYears,
    inSchoolMonths,
  };
}

// ------------------------------------
// Render results
// ------------------------------------
function renderResults(optResult) {
  const resultsSection = $("#results");
  const allocationTableDiv = $("#allocation-table");
  const summaryDiv = $("#summary");
  const btnExplain = $("#btn-explain");

  if (!optResult) return;

  resultsSection.hidden = false;

  const stats = optResult.allocation.map(computeLoanStats);

  const totalNetToUser = stats.reduce((s, x) => s + x.netToUser, 0);
  const totalPrincipal = stats.reduce((s, x) => s + x.principal, 0);
  const totalOrigFees = stats.reduce((s, x) => s + x.origFee, 0);
  const totalInterest = stats.reduce((s, x) => s + x.totalInterest, 0);
  const totalRepaid = stats.reduce((s, x) => s + x.totalRepaid, 0);

  // Table
  let html = "";
  if (!stats.length) {
    html = "<p>No allocations found. Check your target and loan caps.</p>";
  } else {
    html += `<table>
      <thead>
        <tr>
          <th>Loan</th>
          <th>Net to you ($)</th>
          <th>Principal borrowed ($)</th>
          <th>Origination fee ($)</th>
          <th>Est. monthly payment</th>
          <th>Est. total repaid</th>
          <th>Est. total interest</th>
        </tr>
      </thead>
      <tbody>`;

    stats.forEach((s) => {
      html += `<tr>
        <td>${s.name}</td>
        <td>$${s.netToUser.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>$${s.principal.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>$${s.origFee.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>$${s.monthlyPayment.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} / mo</td>
        <td>$${s.totalRepaid.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>$${s.totalInterest.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
      </tr>`;
    });

    html += `</tbody></table>`;
  }

  allocationTableDiv.innerHTML = html;

  // Summary text
  let summaryHtml = `<p>Target amount you want to cover (net cash): <strong>$${optResult.targetNetNeeded.toLocaleString(
    undefined,
    { maximumFractionDigits: 2 }
  )}</strong>.</p>`;

  summaryHtml += `<p>Total net disbursed from this mix: <strong>$${totalNetToUser.toLocaleString(
    undefined,
    { maximumFractionDigits: 2 }
  )}</strong>.</p>`;

  summaryHtml += `<p>Total principal borrowed across loans: <strong>$${totalPrincipal.toLocaleString(
    undefined,
    { maximumFractionDigits: 2 }
  )}</strong>.</p>`;

  summaryHtml += `<p>Total origination fees: <strong>$${totalOrigFees.toLocaleString(
    undefined,
    { maximumFractionDigits: 2 }
  )}</strong>.</p>`;

  summaryHtml += `<p>Estimated total interest over the life of these loans: <strong>$${totalInterest.toLocaleString(
    undefined,
    { maximumFractionDigits: 2 }
  )}</strong>.</p>`;

  summaryHtml += `<p>Estimated total repaid (principal + interest): <strong>$${totalRepaid.toLocaleString(
    undefined,
    { maximumFractionDigits: 2 }
  )}</strong>.</p>`;

  if (optResult.remainingNet > 0) {
    summaryHtml += `<p><strong>Uncovered net amount:</strong> $${optResult.remainingNet.toLocaleString(
      undefined,
      { maximumFractionDigits: 2 }
    )} (no remaining loan caps for this portion).</p>`;
  } else {
    summaryHtml += `<p>All of your target net amount is covered by the loans entered.</p>`;
  }

  summaryHtml += `<p class="muted">These are rough estimates using fixed-rate amortization. Actual interest and payments may differ based on your servicer’s terms.</p>`;

  summaryDiv.innerHTML = summaryHtml;

  // Enable "Explain this plan"
  btnExplain.disabled = false;

  // Store last plan (for /explain) in a global-ish place
  window.lastPlanForExplain = {
    targetAmount: optResult.targetNetNeeded,
    // make a simpler structure for the explanation endpoint
    loans: stats.map((s) => ({
      name: s.name,
      interestRatePercent: s.interestRatePercent,
      principal: s.principal,
      origFee: s.origFee,
      netToUser: s.netToUser,
      monthlyPayment: s.monthlyPayment,
      totalRepaid: s.totalRepaid,
      totalInterest: s.totalInterest,
      termYears: s.termYears,
      inSchoolMonths: s.inSchoolMonths,
    })),
  };
}

// ------------------------------------
// Parse with GPT (Cloudflare Worker /parse)
// ------------------------------------
async function parseFreeTextAndFill() {
  const btnParse = $("#btn-parse");
  const freeText = $("#free-text");
  const text = freeText.value.trim();
  if (!text) {
    alert("Please paste or type your loan details first.");
    return;
  }

  btnParse.disabled = true;
  btnParse.textContent = "Parsing...";

  try {
    const res = await fetch(`${API_BASE}/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ freeText: text }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Parse error:", errText);
      alert("Error parsing with AI. Check console for details.");
      return;
    }

    const data = await res.json();
    const { target_amount, loans, notes } = data;

    if (target_amount != null) {
      $("#target-amount").value = target_amount;
    }

    const loansContainer = $("#loans");
    loansContainer.innerHTML = "";
    if (Array.isArray(loans) && loans.length > 0) {
      loans.forEach((loan) => {
        addLoanRow({
          name: loan.name,
          interestRatePercent: loan.interest_rate_percent,
          originationFeePercent: loan.origination_fee_percent,
          borrowingCap: loan.borrowing_cap,
          repaymentTermYears: loan.repayment_term_years,
          inSchoolMonths: loan.in_school_months,
        });
      });
    } else {
      addLoanRow();
    }

    if (notes) {
      alert("AI notes:\n\n" + notes);
    }
  } catch (err) {
    console.error(err);
    alert("Unexpected error during AI parsing.");
  } finally {
    btnParse.disabled = false;
    btnParse.textContent = "Fill the form from this text";
  }
}

// ------------------------------------
// Explain with GPT (/explain) using lastPlanForExplain
// ------------------------------------
async function requestExplanation() {
  const btnExplain = $("#btn-explain");
  const explainSection = $("#explain");
  const explanationText = $("#explanation-text");
  const payload = window.lastPlanForExplain;

  if (!payload) return;

  btnExplain.disabled = true;
  btnExplain.textContent = "Explaining...";

  try {
    const res = await fetch(`${API_BASE}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Explain error:", errText);
      explanationText.textContent =
        "There was an error generating the explanation. Please try again.";
      explainSection.hidden = false;
      return;
    }

    const data = await res.json();
    const explanation = data.explanation || JSON.stringify(data);
    explanationText.textContent = explanation;
    explainSection.hidden = false;
  } catch (err) {
    console.error(err);
    explanationText.textContent =
      "Unexpected error generating explanation. Please try again.";
    explainSection.hidden = false;
  } finally {
    btnExplain.disabled = false;
    btnExplain.textContent = "Explain this plan";
  }
}

// ------------------------------------
// DOMContentLoaded: wire everything
// ------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Start with one blank row
  addLoanRow();

  $("#add-loan").addEventListener("click", () => addLoanRow());
  $("#btn-parse").addEventListener("click", parseFreeTextAndFill);

  $("#optimize").addEventListener("click", () => {
    const targetInput = $("#target-amount");
    const targetAmount = parseFloat(targetInput.value || "0");

    if (isNaN(targetAmount) || targetAmount <= 0) {
      alert("Please enter a positive target amount to finance.");
      return;
    }

    const loans = readLoansFromForm();
    if (!loans.length) {
      alert("Please enter at least one loan option.");
      return;
    }

    const optResult = optimizeMix(targetAmount, loans);
    renderResults(optResult);
  });

  $("#btn-explain").addEventListener("click", requestExplanation);
});
