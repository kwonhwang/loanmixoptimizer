const $ = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>[...root.querySelectorAll(sel)];

function addLoanRow() {
  const t = $('#loan-row').content.cloneNode(true);
  t.querySelector('.remove-loan').addEventListener('click', e => {
    e.currentTarget.closest('.loan').remove();
  });
  $('#loans').appendChild(t);
}

// Simplified cost model: estimates total dollars repaid per dollar borrowed
// Includes orig fee, in-school accrual interest (simple), and term amortization (Interest Rate approx)
function costPerDollar({interestRate, feePct, accrualMonths, termYears}) {
  const rate = (interestRate || 0) / 100;
  const fee = (feePct || 0) / 100;
  const term = Math.max(1, termYears || 10);
  const months = Math.max(0, accrualMonths || 0);
  // Origination fee increases amount owed at t0:
  const principal_effective = 1 + fee;

  // In-school simple interest (approx) on principal for months/12 at Interest Rate
  const in_school_interest = rate * (months/12);

  // Amortized repayment interest on (principal + accrued) across term
  // Rough factor: total repaid ≈ principal * (1 + avg_rate * term)
  // Using a conservative approximation (Interest Rate * term * 0.55) to mimic amortization curve,
  // so it doesn't overstate like simple interest.
  const amortization_interest_factor = rate * term * 0.55;

  const total_factor = principal_effective * (1 + in_school_interest) * (1 + amortization_interest_factor);
  return total_factor; // dollars repaid per $1 borrowed
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

  // Rank by cost per dollar (lower is better)
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

  if (need > 0) {
    renderResults(allocation, target, false, need);
    return;
  }
  renderResults(allocation, target, true, 0);
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
    <p class="muted">Note: This MVP uses a simplified cost model and greedy allocation. You’ll improve this in the Python step.</p>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  // seed with two example loans
  addLoanRow(); addLoanRow();
  const [l1, l2] = $$('.loan');
  if (l1) {
    $('.loan-name', l1).value = 'Direct Subsidized';
    $('.loan-interest', l1).value = '6.53';
    $('.loan-fee', l1).value = '1.057';
    $('.loan-cap', l1).value = '5500';
    $('.loan-term', l1).value = '10';
    $('.loan-accrual', l1).value = '0'; // subsidized (approx)
  }
  if (l2) {
    $('.loan-name', l2).value = 'Direct Unsubsidized';
    $('.loan-interest', l2).value = '8.08';
    $('.loan-fee', l2).value = '1.057';
    $('.loan-cap', l2).value = '12000';
    $('.loan-term', l2).value = '10';
    $('.loan-accrual', l2).value = '24';
  }

  $('#add-loan').addEventListener('click', addLoanRow);
  $('#optimize').addEventListener('click', optimize);
});
