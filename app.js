// app.js
const API_BASE = "https://loanmixoptimizer.kwonhwan.workers.dev"; 

let lastPlan = null; // stores the last optimization result for explanation

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

  // -------------------------------
  // Helpers to create/remove loan rows
  // -------------------------------
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

  // -------------------------------
  // Read data from form into JS objects
  // -------------------------------
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

  // -------------------------------
  // Simple greedy optimizer:
  // fill lowest interest loans first up to their caps
  // -------------------------------
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
        totalBorrowed: amount,
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

  // -------------------------------
  // Render results into the DOM
  // -------------------------------
  function renderResults(plan) {
    if (!plan) return;

    resultsSection.hidden = false;

    const totalPrincipal = plan.allocation.reduce(
      (sum, a) => sum + a.amountPrincipal,
      0
    );

    // Table
    let html = "";
    if (plan.allocation.length === 0) {
      html = "<p>No allocations found. Check your target and loan caps.</p>";
    } else {
      html += `<table>
        <thead>
          <tr>
            <th>Loan</th>
            <th>Interest Rate</br>(APR)</th>
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
          <td>${a.interestRatePercent != null ? a.interestRatePercent.toFixed(2) : "—"}%</td>
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

    // Summary text
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

    // Enable "Explain this plan"
    btnExplain.disabled = false;
  }

  // -------------------------------
  // Optimize Mix click handler
  // -------------------------------
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

  // -------------------------------
  // Fill the form from free-text (calls /parse)
  // -------------------------------
  btnParse.addEventListener("click", async () => {
    const text = document.getElementById("free-text").value.trim();
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
        const err = await res.text();
        console.error("Parse error:", err);
        alert("Error parsing with AI. Check console for details.");
        return;
      }

      const data = await res.json();
      const { target_amount, loans, notes } = data;

      // Fill target amount
      if (target_amount != null) {
        document.getElementById("target-amount").value = target_amount;
      }

      // Clear current loans and add AI-parsed ones
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
  });

  // -------------------------------
  // Explain this plan (calls /explain)
  // -------------------------------
  btnExplain.addEventListener("click", async () => {
    if (!lastPlan) return;

    btnExplain.disabled = true;
    btnExplain.textContent = "Explaining...";

    try {
      const res = await fetch(`${API_BASE}/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAmount: lastPlan.targetAmount,
          loans: lastPlan.loans,
          plan: lastPlan.plan,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("Explain error:", err);
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
  });
});
