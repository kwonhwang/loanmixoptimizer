// app.js
// TODO: change this once you deploy your Cloudflare Worker
const API_BASE = "https://your-worker-subdomain.workers.dev"; 

let lastPlan = null; // store last optimization result for explanation

document.addEventListener("DOMContentLoaded", () => {
  const loansContainer = document.getElementById("loans");
  const loanTemplate = document.getElementById("loan-row");
  const btnAddLoan = document.getElementById("add-loan");
  const btnOptimize = document.getElementById("optimize");
  const btnParse = document.getElementById("btn-parse");
  const btnExplain = document.getElementById("btn-explain");

  const resultsSection = document.getElementById("results");
  const allocationTableDiv = document.getElementById("allocation-table");
  const summaryDiv = document.getElementById("summary");

  const explainSection = document.getElementById("explain");
  const explanationText = document.getElementById("explanation-text");

  // --- helpers to create/remove loan rows ---
  function addLoanRow(prefill = {}) {
    const clone = loanTemplate.content.cloneNode(true);
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
    removeBtn.addEventListener("click", () => {
      fieldset.remove();
    });

    loansContainer.appendChild(clone);
  }

  // Start with one blank loan row
  addLoanRow();

  btnAddLoan.addEventListener("click", () => addLoanRow());

  // --- read data from form into JS objects ---
  function readLoansFromForm() {
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
        interestRatePercent,
        originationFeePercent,
        borrowingCap: isNaN(borrowingCap) || borrowingCap <= 0 ? null : borrowingCap,
        repaymentTermYears: isNaN(repaymentTermYears) || repaymentTermYears <= 0
          ? null
          : repaymentTermYears,
        inSchoolMonths: isNaN(inSchoolMonths) || inSchoolMonths < 0
          ? null
          : inSchoolMonths,
      });
    });
    return loans;
  }

  // simple greedy optimizer: fill lowest interest loans first up to caps
  function optimizeMix(targetAmount, loans) {
    const sorted = [...loans].sort(
      (a, b) => (a.interestRatePercent || 0) - (b.interestRatePercent || 0)
    );

    let remaining = targetAmount;
    const allocation = [];

    for (const loan of sorted) {
      if (remaining <= 0) break;

      const cap = loan.borrowingCap ?? remaining;
      const amount = Math.min(cap, remaining);
      if (amount <= 0) continue;

      const feeRate = (loan.originationFeePercent || 0) / 100;
      const fee = amount * feeRate;

      allocation.push({
        name: loan.name,
        interestRatePercent: loan.interestRatePercent,
        originationFeePercent: loan.originationFeePercent,
        amountPrincipal: amount,
        feeAmount: fee,
        totalBorrowed: amount, // principal
        totalFees: fee,
      });

      remaining -= amount;
    }

    return {
      targetAmount,
      allocation,
      uncoveredAmount: Math.max(0, remaining),
    };
  }

  function renderResults(plan) {
    if (!plan) return;

    resultsSection.hidden = false;

    const totalPrincipal = plan.allocation.reduce(
      (sum, a) => sum + a.amountPrincipal,
      0
    );

    // table
    let html = "";
    if (plan.allocation.length === 0) {
      html = "<p>No allocations found. Check your target and loan caps.</p>";
    } else {
      html += `<table>
        <thead>
          <tr>
            <th>Loan</th>
            <th>Interest Rate</th>
            <th>Principal</th>
            <th>Origination Fee</th>
            <th>% of Principal</th>
          </tr>
        </thead>
        <tbody>`;

      plan.allocation.forEach((a) => {
        const pct = totalPrincipal
          ? ((a.amountPrincipal / totalPrincipal) * 100).toFixed(1)
          : "0.0";
        html += `<tr>
          <td>${a.name}</td>
          <td>${a.interestRatePercent?.toFixed(2) || "—"}%</td>
          <td>$${a.amountPrincipal.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}</td>
          <td>$${a.feeAmount.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}</td>
          <td>${pct}%</td>
        </tr>`;
      });

      html += `</tbody></table>`;
    }

    allocationTableDiv.innerHTML = html;

    // summary text
    let summaryHtml = `<p>Target amount to finance: <strong>$${plan.targetAmount.toLocaleString(
      undefined,
      { maximumFractionDigits: 2 }
    )}</strong>.</p>`;

    const totalPrincipalUsed = totalPrincipal.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });

    summaryHtml += `<p>Total principal allocated across loans: <strong>$${totalPrincipalUsed}</strong>.</p>`;

    if (plan.uncoveredAmount > 0) {
      summaryHtml += `<p><strong>Uncovered amount:</strong> $${plan.uncoveredAmount.toLocaleString(
        undefined,
        { maximumFractionDigits: 2 }
      )} (no remaining loan caps for this portion).</p>`;
    } else {
      summaryHtml += `<p>All of your target amount is covered by the loans entered.</p>`;
    }

    summaryDiv.innerHTML = summaryHtml;

    // enable "Explain this plan" (GPT call will be wired later)
    btnExplain.disabled = false;
  }

  // --- click: Optimize Mix (local only for now) ---
  btnOptimize.addEventListener("click", () => {
    const targetInput = document.getElementById("target-amount");
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

    const plan = optimizeMix(targetAmount, loans);
    lastPlan = {
      targetAmount,
      loans,
      plan,
    };

    renderResults(plan);
  });

  // --- click: Fill the form from this text (GPT later) ---
  btnParse.addEventListener("click", async () => {
    const text = document.getElementById("free-text").value.trim();
    if (!text) {
      alert("Please paste or type your loan details first.");
      return;
    }

    // For now, just stub; we'll wire GPT/Cloudflare in the next step
    alert(
      "AI parsing is not wired yet. Once the Cloudflare Worker is set up, this will call GPT to fill the form."
    );
  });

  // --- click: Explain this plan (GPT later) ---
  btnExplain.addEventListener("click", async () => {
    if (!lastPlan) {
      return;
    }
    // For now, just show a placeholder explanation
    explainSection.hidden = false;
    explanationText.textContent =
      "Explanation coming soon. Once the Cloudflare Worker is connected to GPT, this button will send your plan for a concise narrative summary.";
  });
});
