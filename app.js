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
  const accrualInput = fieldset.querySelector(".loan-accrual");
  const subsidizedInput = fieldset.querySelector(".loan-subsidized");

  if (prefill.name) nameInput.value = prefill.name;
  if (prefill.interestRatePercent != null)
    interestInput.value = prefill.interestRatePercent;
  if (prefill.originationFeePercent != null)
    feeInput.value = prefill.originationFeePercent;
  if (prefill.borrowingCap != null) capInput.value = prefill.borrowingCap;
  if (prefill.inSchoolMonths != null)
    accrualInput.value = prefill.inSchoolMonths;
  if (prefill.subsidizedInSchool != null)
    subsidizedInput.checked = !!prefill.subsidizedInSchool;

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
    const inSchoolMonths = parseFloat(
      fs.querySelector(".loan-accrual").value || "0"
    );
    const subsidizedInSchool = fs.querySelector(".loan-subsidized").checked;

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
      inSchoolMonths:
        isNaN(inSchoolMonths) || inSchoolMonths < 0 ? null : inSchoolMonths,
      subsidizedInSchool,
    });
  });
  return loans;
}

// ------------------------------------
// Optimization: allocate lowest-APR loans first
// Target is NET cash needed (after fees).
// netFromLoan = principal * (1 - feeRate)
// ------------------------------------
function optimizeMix(targetAmount, loans) {
  const sorted = [...loans].sort(
    (a, b) => (a.interestRatePercent || 0) - (b.interestRatePercent || 0)
  );

  let remainingNet = targetAmount;
  const allocation = [];

  for (const loan of sorted) {
    if (remainingNet <= 0) break;

    const feeRate = (loan.originationFeePercent || 0) / 100;
    const capPrincipal = loan.borrowingCap ?? Infinity;
    const maxNetFromLoan =
      feeRate < 1 ? capPrincipal * (1 - feeRate) : 0;

    if (maxNetFromLoan <= 0) continue;

    const netUsed = Math.min(remainingNet, maxNetFromLoan);
    const principalUsed =
      feeRate < 1 ? netUsed / (1 - feeRate) : 0;

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
// Loan stats – in-school only
// ------------------------------------
function computeLoanStats(entry) {
  const { loan, principal } = entry;
  const rate = (loan.interestRatePercent || 0) / 100;
  const feeRate = (loan.originationFeePercent || 0) / 100;
  const inSchoolMonths = loan.inSchoolMonths || 0;
  const subsidizedInSchool = !!loan.subsidizedInSchool;

  const origFee = principal * feeRate;
  const netToUser = principal - origFee;

  const inSchoolInterest = subsidizedInSchool
    ? 0
    : principal * rate * (inSchoolMonths / 12);

  const capitalizedPrincipal = principal + inSchoolInterest;

  return {
    name: loan.name,
    interestRatePercent: loan.interestRatePercent,
    principal,
    origFee,
    netToUser,
    inSchoolInterest,
    capitalizedPrincipal,
    inSchoolMonths,
    subsidizedInSchool,
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
  const totalInSchoolInterest = stats.reduce(
    (s, x) => s + x.inSchoolInterest,
    0
  );

  let html = "";
  if (!stats.length) {
    html = "<p>No allocations found. Check your target amount and loan caps.</p>";
  } else {
    html += `<table>
      <thead>
        <tr>
          <th>Loan</th>
          <th>Net to you ($)</th>
          <th>Principal borrowed ($)</th>
          <th>Origination fee ($)</th>
          <th>Est. in-school interest ($)</th>
          <th>Balance after school ($)</th>
        </tr>
      </thead>
      <tbody>`;

    stats.forEach((s) => {
      html += `<tr>
        <td>${s.name}${s.subsidizedInSchool ? " (subsidized in school)" : ""}</td>
        <td>$${s.netToUser.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>$${s.principal.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>$${s.origFee.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>$${s.inSchoolInterest.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>$${s.capitalizedPrincipal.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
      </tr>`;
    });

    html += `</tbody></table>`;
  }

  allocationTableDiv.innerHTML = html;

  let summaryHtml = `<p>Target net amount to cover (after fees): <strong>$${optResult.targetNetNeeded.toLocaleString(
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

  summaryHtml += `<p>Estimated total interest that accrues while you are in school: <strong>$${totalInSchoolInterest.toLocaleString(
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

  summaryHtml += `<p class="muted">
    These numbers only reflect interest that may accrue while you are in school and the balance at the end of that period.
    Actual repayment will also depend on your servicer's grace period, repayment plan, and other terms.
  </p>`;

  summaryDiv.innerHTML = summaryHtml;

  btnExplain.disabled = false;

  // Save simplified payload for /explain
  window.lastPlanForExplain = {
    targetAmount: optResult.targetNetNeeded,
    loans: stats.map((s) => ({
      name: s.name,
      interestRatePercent: s.interestRatePercent,
      principal: s.principal,
      origFee: s.origFee,
      netToUser: s.netToUser,
      inSchoolInterest: s.inSchoolInterest,
      capitalizedPrincipal: s.capitalizedPrincipal,
      inSchoolMonths: s.inSchoolMonths,
      subsidizedInSchool: s.subsidizedInSchool,
    })),
  };
}

// ------------------------------------
// Parse with GPT (/parse)
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
          inSchoolMonths: loan.in_school_months,
          subsidizedInSchool: loan.subsidized_in_school ?? false,
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
// Explain with GPT (/explain)
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
// Speech recognition (browser Web Speech API)
// ------------------------------------
function setupSpeechRecognition() {
  const btnSpeech = $("#btn-speech");
  const speechStatus = $("#speech-status");
  const freeText = $("#free-text");
  const btnParse = $("#btn-parse");

  // If elements not on page, do nothing
  if (!btnSpeech || !speechStatus || !freeText) return;

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    btnSpeech.disabled = true;
    speechStatus.textContent = "Speech input not supported in this browser.";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;

  let isListening = false;

  btnSpeech.addEventListener("click", () => {
    if (!isListening) {
      try {
        recognition.start();
        isListening = true;
        btnSpeech.textContent = "⏹ Stop";
        speechStatus.textContent = "Listening… speak your loan details.";
        if (btnParse) btnParse.disabled = true;
      } catch (e) {
        console.error("Error starting recognition:", e);
      }
    } else {
      recognition.stop();
    }
  });

  recognition.addEventListener("result", (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    const existing = freeText.value.trim();
    freeText.value = existing
      ? existing + "\n" + transcript.trim()
      : transcript.trim();
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    btnSpeech.textContent = "🎙 Speak instead";
    speechStatus.textContent =
      "Finished listening. Edit if needed, then click “Fill the form from this text”.";
    if (btnParse) btnParse.disabled = false;
  });

  recognition.addEventListener("error", (event) => {
    console.error("Speech recognition error:", event.error);
    isListening = false;
    btnSpeech.textContent = "🎙 Speak instead";
    if (btnParse) btnParse.disabled = false;

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      speechStatus.textContent =
        "Microphone permission was denied. Allow mic access in your browser settings.";
    } else if (event.error === "no-speech") {
      speechStatus.textContent =
        "No speech detected. Try again and speak clearly into the mic.";
    } else {
      speechStatus.textContent =
        "Speech recognition error. Try again or type your details instead.";
    }
  });
}


// ------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  addLoanRow();

  $("#add-loan").addEventListener("click", () => addLoanRow());
  $("#btn-parse").addEventListener("click", parseFreeTextAndFill);

  $("#optimize").addEventListener("click", () => {
  // --- RESET EXPLANATION ---
  const explainSection = $("#explain");
  const explanationText = $("#explanation-text");
  const btnExplain = $("#btn-explain");

  explanationText.textContent = "";
  explainSection.hidden = true;
  btnExplain.disabled = true;   // re-enabled after results

  // --- RUN OPTIMIZATION ---
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
  renderResults(optResult);   // this re-enables "Explain" after successful run
});


  $("#btn-explain").addEventListener("click", requestExplanation);

    setupSpeechRecognition();
});
