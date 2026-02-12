import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { firebaseConfig } from './firebase-config.js';

const form = document.getElementById("transactionForm");
const typeEl = document.getElementById("type");
const amountEl = document.getElementById("amount");
const categoryEl = document.getElementById("category");
const dateEl = document.getElementById("date");
const noteEl = document.getElementById("note");
const submitBtn = document.getElementById("submitBtn");
const resetBtn = document.getElementById("resetBtn");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");
const filterTypeEl = document.getElementById("filterType");
const tbody = document.getElementById("transactionsBody");
const incomeTotalEl = document.getElementById("incomeTotal");
const expenseTotalEl = document.getElementById("expenseTotal");
const balanceTotalEl = document.getElementById("balanceTotal");
const statusEl = document.getElementById("statusMessage");

const authForm = document.getElementById("authForm");
const authEmailEl = document.getElementById("authEmail");
const authPasswordEl = document.getElementById("authPassword");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const userMetaEl = document.getElementById("userMeta");
const authModeButtons = document.querySelectorAll("[data-auth-mode]");
const appContent = document.getElementById("appContent");

let db = null;
let auth = null;
let currentUser = null;
let authMode = "login";
let transactions = [];
let editingId = null;
let categoryChart = null;
let monthlyChart = null;
let unsubscribe = null;

const moneyFormat = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

const dateFormat = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function setToday() {
  const today = new Date().toISOString().slice(0, 10);
  dateEl.value = today;
}

function showStatus(message, kind = "info") {
  statusEl.textContent = message;
  statusEl.style.color = kind === "error" ? "#ffd6d6" : "#f1f7ff";
}

function isConfigValid(config) {
  return Object.values(config).every(
    (value) => typeof value === "string" && value.trim().length > 0 && !value.includes("YOUR_")
  );
}

function sanitize(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toCurrency(amount) {
  return moneyFormat.format(amount || 0);
}

function formatDate(isoDate) {
  if (!isoDate) return "-";
  const d = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(d.getTime()) ? isoDate : dateFormat.format(d);
}

function resetForm() {
  editingId = null;
  form.reset();
  setToday();
  typeEl.value = "expense";
  submitBtn.textContent = "Opslaan";
}

function resetDashboard() {
  transactions = [];
  resetForm();
  draw();
}

function collectFormData() {
  const amount = Number(amountEl.value);
  const payload = {
    type: typeEl.value,
    amount,
    category: categoryEl.value.trim(),
    date: dateEl.value,
    note: noteEl.value.trim(),
  };

  if (!["income", "expense"].includes(payload.type)) {
    throw new Error("Type is ongeldig.");
  }

  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    throw new Error("Bedrag moet groter zijn dan 0.");
  }

  if (!payload.category) {
    throw new Error("Categorie is verplicht.");
  }

  if (!payload.date) {
    throw new Error("Datum is verplicht.");
  }

  return payload;
}

function getFilteredTransactions() {
  const currentFilter = filterTypeEl.value;
  if (currentFilter === "all") return transactions;
  return transactions.filter((item) => item.type === currentFilter);
}

function buildTotals(items) {
  let income = 0;
  let expense = 0;

  for (const tx of items) {
    if (tx.type === "income") income += tx.amount;
    if (tx.type === "expense") expense += tx.amount;
  }

  return { income, expense, balance: income - expense };
}

function updateSummary() {
  const totals = buildTotals(transactions);
  incomeTotalEl.textContent = toCurrency(totals.income);
  expenseTotalEl.textContent = toCurrency(totals.expense);
  balanceTotalEl.textContent = toCurrency(totals.balance);
  balanceTotalEl.style.color = totals.balance >= 0 ? "#1f9d63" : "#d94848";
}

function renderTable() {
  if (!currentUser) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#6a7b8d;">Log in om transacties te zien.</td></tr>';
    return;
  }

  const items = getFilteredTransactions();
  if (items.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="color:#6a7b8d;">Nog geen transacties voor dit filter.</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .map(
      (tx) => `
      <tr>
        <td>${sanitize(formatDate(tx.date))}</td>
        <td><span class="chip ${sanitize(tx.type)}">${tx.type === "income" ? "Inkomst" : "Uitgave"}</span></td>
        <td>${sanitize(tx.category)}</td>
        <td>${sanitize(toCurrency(tx.amount))}</td>
        <td>${sanitize(tx.note || "-")}</td>
        <td>
          <div class="action-row">
            <button class="btn-mini" type="button" data-action="edit" data-id="${sanitize(tx.id)}">Bewerk</button>
            <button class="btn-mini delete" type="button" data-action="delete" data-id="${sanitize(tx.id)}">Verwijder</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
}

function buildCategoryDataset(items) {
  const sums = {};
  for (const tx of items) {
    if (tx.type !== "expense") continue;
    sums[tx.category] = (sums[tx.category] || 0) + tx.amount;
  }

  return {
    labels: Object.keys(sums),
    values: Object.values(sums),
  };
}

function monthKeyFromDate(dateString) {
  return dateString.slice(0, 7);
}

function buildLastMonths(count = 6) {
  const months = [];
  const now = new Date();

  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("nl-NL", {
      month: "short",
      year: "2-digit",
    }).format(d);
    months.push({ key, label });
  }

  return months;
}

function buildMonthlyDataset(items, months) {
  const incomeMap = Object.fromEntries(months.map((m) => [m.key, 0]));
  const expenseMap = Object.fromEntries(months.map((m) => [m.key, 0]));

  for (const tx of items) {
    const key = monthKeyFromDate(tx.date);
    if (!(key in incomeMap)) continue;

    if (tx.type === "income") incomeMap[key] += tx.amount;
    if (tx.type === "expense") expenseMap[key] += tx.amount;
  }

  return {
    income: months.map((m) => incomeMap[m.key]),
    expense: months.map((m) => expenseMap[m.key]),
  };
}

function renderCharts() {
  const ChartCtor = window.Chart;
  if (!ChartCtor) return;

  const categoryCtx = document.getElementById("categoryChart");
  const monthlyCtx = document.getElementById("monthlyChart");

  const categoryData = buildCategoryDataset(transactions);
  if (categoryChart) categoryChart.destroy();
  categoryChart = new ChartCtor(categoryCtx, {
    type: "doughnut",
    data: {
      labels: categoryData.labels.length ? categoryData.labels : ["Geen uitgaven"],
      datasets: [
        {
          data: categoryData.values.length ? categoryData.values : [1],
          backgroundColor: ["#0f78d1", "#30a6e7", "#1f9d63", "#f59f00", "#d94848", "#7d55c7"],
        },
      ],
    },
    options: {
      plugins: {
        legend: { position: "bottom" },
      },
    },
  });

  const months = buildLastMonths(6);
  const monthlyData = buildMonthlyDataset(transactions, months);

  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new ChartCtor(monthlyCtx, {
    type: "bar",
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        {
          label: "Inkomsten",
          data: monthlyData.income,
          backgroundColor: "#1f9d63",
          borderRadius: 6,
        },
        {
          label: "Uitgaven",
          data: monthlyData.expense,
          backgroundColor: "#d94848",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  });
}

function draw() {
  updateSummary();
  renderTable();
  renderCharts();
}

function setAuthMode(mode) {
  authMode = mode;
  authSubmitBtn.textContent = mode === "register" ? "Registreren" : "Inloggen";
  authModeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.authMode === mode);
  });
}

function setAppAccess(signedIn) {
  appContent.classList.toggle("hidden", !signedIn);
  refreshBtn.disabled = !signedIn;
  logoutBtn.disabled = !signedIn;
}

function getTransactionsCollectionRef() {
  if (!currentUser) throw new Error("Je bent niet ingelogd.");
  return collection(db, "users", currentUser.uid, "transactions");
}

function stopListener() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

function startListener() {
  stopListener();

  const transactionsRef = getTransactionsCollectionRef();
  const transactionsQuery = query(transactionsRef, orderBy("date", "desc"));

  unsubscribe = onSnapshot(
    transactionsQuery,
    (snapshot) => {
      transactions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      draw();
      showStatus(`Sync gelukt: ${transactions.length} transactie(s) geladen.`);
    },
    (error) => {
      console.error(error);
      showStatus(`Kon data niet laden: ${error.message}`, "error");
    }
  );
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  if (!auth) return;

  const email = authEmailEl.value.trim();
  const password = authPasswordEl.value;

  if (!email || !password) {
    showStatus("Vul e-mail en wachtwoord in.", "error");
    return;
  }

  if (password.length < 6) {
    showStatus("Wachtwoord moet minimaal 6 tekens hebben.", "error");
    return;
  }

  try {
    if (authMode === "register") {
      await createUserWithEmailAndPassword(auth, email, password);
      showStatus("Account gemaakt. Je bent nu ingelogd.");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showStatus("Succesvol ingelogd.");
    }
    authForm.reset();
  } catch (error) {
    showStatus(`Inloggen mislukt: ${error.message}`, "error");
  }
}

async function handleLogout() {
  if (!auth || !currentUser) return;

  try {
    await signOut(auth);
    showStatus("Je bent uitgelogd.");
  } catch (error) {
    showStatus(`Uitloggen mislukt: ${error.message}`, "error");
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!db || !currentUser) {
    showStatus("Log eerst in om een transactie op te slaan.", "error");
    return;
  }

  try {
    const payload = collectFormData();
    const ref = getTransactionsCollectionRef();

    if (editingId) {
      await updateDoc(doc(db, "users", currentUser.uid, "transactions", editingId), {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      showStatus("Transactie bijgewerkt.");
    } else {
      await addDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showStatus("Transactie opgeslagen.");
    }

    resetForm();
  } catch (error) {
    showStatus(error.message || "Opslaan mislukt.", "error");
  }
}

function handleTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || !db || !currentUser) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  const target = transactions.find((tx) => tx.id === id);
  if (!target) return;

  if (action === "edit") {
    editingId = target.id;
    typeEl.value = target.type;
    amountEl.value = target.amount;
    categoryEl.value = target.category;
    dateEl.value = target.date;
    noteEl.value = target.note || "";
    submitBtn.textContent = "Wijziging opslaan";
    showStatus("Bewerkmodus actief.");
  }

  if (action === "delete") {
    const confirmed = window.confirm("Weet je zeker dat je deze transactie wilt verwijderen?");
    if (!confirmed) return;

    deleteDoc(doc(db, "users", currentUser.uid, "transactions", id))
      .then(() => {
        if (editingId === id) resetForm();
        showStatus("Transactie verwijderd.");
      })
      .catch((error) => showStatus(`Verwijderen mislukt: ${error.message}`, "error"));
  }
}

async function handleRefresh() {
  if (!db || !currentUser) {
    showStatus("Log eerst in om te verversen.", "error");
    return;
  }

  try {
    const snapshot = await getDocs(query(getTransactionsCollectionRef(), orderBy("date", "desc")));
    transactions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    draw();
    showStatus(`Handmatig ververst: ${transactions.length} transactie(s).`);
  } catch (error) {
    showStatus(`Verversen mislukt: ${error.message}`, "error");
  }
}

function bindEvents() {
  form.addEventListener("submit", handleSubmit);
  resetBtn.addEventListener("click", resetForm);
  refreshBtn.addEventListener("click", handleRefresh);
  logoutBtn.addEventListener("click", handleLogout);
  tbody.addEventListener("click", handleTableClick);
  filterTypeEl.addEventListener("change", renderTable);
  authForm.addEventListener("submit", handleAuthSubmit);

  authModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setAuthMode(btn.dataset.authMode));
  });
}

function handleAuthStateChange(user) {
  currentUser = user;
  editingId = null;

  if (user) {
    userMetaEl.textContent = `Ingelogd als ${user.email}`;
    setAppAccess(true);
    setToday();
    startListener();
    return;
  }

  userMetaEl.textContent = "Niet ingelogd";
  setAppAccess(false);
  stopListener();
  resetDashboard();
  showStatus("Log in om je gegevens te laden.");
}

function init() {
  setToday();
  setAuthMode("login");
  bindEvents();

  if (!isConfigValid(firebaseConfig)) {
    showStatus(
      "Firebase config ontbreekt. Vul firebase-config.js in met je eigen projectgegevens.",
      "error"
    );
    return;
  }

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);

  onAuthStateChanged(auth, handleAuthStateChange);
}

window.addEventListener("beforeunload", () => {
  stopListener();
});

init();
