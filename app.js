// 1. Alle Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
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
import { firebaseConfig } from './firebase-config.js';

// 2. HTML Elementen ophalen
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
const googleLoginBtn = document.getElementById("googleLoginBtn");

// 3. Variabelen
let db = null;
let auth = null;
let currentUser = null;
let authMode = "login";
let transactions = [];
let editingId = null;
let unsubscribe = null;
const provider = new GoogleAuthProvider();

const moneyFormat = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const dateFormat = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });

// --- HULPFUNCTIES ---
function setToday() { if(dateEl) dateEl.value = new Date().toISOString().slice(0, 10); }
function showStatus(message, kind = "info") {
  statusEl.textContent = message;
  statusEl.style.color = kind === "error" ? "#ffd6d6" : "#f1f7ff";
}
function sanitize(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function toCurrency(amount) { return moneyFormat.format(amount || 0); }
function formatDate(isoDate) {
  if (!isoDate) return "-";
  const d = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(d.getTime()) ? isoDate : dateFormat.format(d);
}

// --- LOGICA ---
function resetForm() {
  editingId = null;
  form.reset();
  setToday();
  typeEl.value = "expense";
  submitBtn.textContent = "Opslaan";
}

function updateSummary() {
  let income = 0; let expense = 0;
  transactions.forEach(tx => {
    if (tx.type === "income") income += tx.amount;
    else expense += tx.amount;
  });
  incomeTotalEl.textContent = toCurrency(income);
  expenseTotalEl.textContent = toCurrency(expense);
  const balance = income - expense;
  balanceTotalEl.textContent = toCurrency(balance);
  balanceTotalEl.style.color = balance >= 0 ? "#1f9d63" : "#d94848";
}

function renderTable() {
  const items = filterTypeEl.value === "all" ? transactions : transactions.filter(t => t.type === filterTypeEl.value);
  tbody.innerHTML = items.map(tx => `
    <tr>
      <td>${sanitize(formatDate(tx.date))}</td>
      <td><span class="chip ${sanitize(tx.type)}">${tx.type === "income" ? "Inkomst" : "Uitgave"}</span></td>
      <td>${sanitize(tx.category)}</td>
      <td>${sanitize(toCurrency(tx.amount))}</td>
      <td>${sanitize(tx.note || "-")}</td>
      <td>
        <button class="btn-mini" data-action="edit" data-id="${tx.id}">Bewerk</button>
        <button class="btn-mini delete" data-action="delete" data-id="${tx.id}">Wis</button>
      </td>
    </tr>`).join("");
}

function draw() {
  updateSummary();
  renderTable();
  renderCharts(); // VOEG DEZE REGEL TOE
}

// --- AUTH ---
async function handleGoogleLogin() {
  try {
    await signInWithPopup(auth, provider);
    showStatus("Google Login succesvol!");
  } catch (error) { showStatus(error.message, "error"); }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = authEmailEl.value.trim();
  const password = authPasswordEl.value;
  try {
    if (authMode === "register") await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
  } catch (error) { showStatus(error.message, "error"); }
}

async function handleLogout() {
  try { await signOut(auth); } catch (e) { console.error(e); }
}

// --- DATABASE ---
function startListener() {
  if (unsubscribe) unsubscribe();
  const q = query(collection(db, "users", currentUser.uid, "transactions"), orderBy("date", "desc"));
  unsubscribe = onSnapshot(q, (snapshot) => {
    transactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    draw();
  });
}

function stopListener() { if (unsubscribe) unsubscribe(); }

async function handleSubmit(e) {
  e.preventDefault();
  const payload = {
    type: typeEl.value,
    amount: Number(amountEl.value),
    category: categoryEl.value,
    date: dateEl.value,
    note: noteEl.value
  };
  try {
    if (editingId) await updateDoc(doc(db, "users", currentUser.uid, "transactions", editingId), payload);
    else await addDoc(collection(db, "users", currentUser.uid, "transactions"), { ...payload, createdAt: serverTimestamp() });
    resetForm();
  } catch (error) { showStatus(error.message, "error"); }
}

function renderCharts() {
  const ctxCat = document.getElementById('categoryChart');
  const ctxMon = document.getElementById('monthlyChart');
  
  if (!ctxCat || !ctxMon) return;

  // 1. Data voorbereiden per categorie
  const catData = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    catData[t.category] = (catData[t.category] || 0) + t.amount;
  });

  // 2. Categorie Grafiek (Pie)
  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(ctxCat, {
    type: 'doughnut',
    data: {
      labels: Object.keys(catData),
      datasets: [{
        data: Object.values(catData),
        backgroundColor: ['#0f78d1', '#d94848', '#1f9d63', '#f39c12', '#9b59b6']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  // 3. Maandelijkse Trends (Bar) - Simpele versie
  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(ctxMon, {
    type: 'bar',
    data: {
      labels: ['Inkomsten', 'Uitgaven'],
      datasets: [{
        label: 'Totaal deze periode',
        data: [
          transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0),
          transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0)
        ],
        backgroundColor: ['#1f9d63', '#d94848']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// --- INITIALISATIE ---
function init() {
  const firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp);
  auth = getAuth(firebaseApp);

  bindEvents();

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    
    // We pakken de HELE sectie (het witte blok) en de app content
    const authSection = document.getElementById("authSection"); 
    const mainApp = document.getElementById("appContent");

    if (user) {
      // Gebruiker is INGELOGD
      userMetaEl.textContent = `Ingelogd als ${user.email}`;
      
      if (mainApp) mainApp.classList.remove("hidden");      // Toon de app
      if (authSection) authSection.classList.add("hidden"); // Verberg het HELE inlogblok
      
      startListener();
    } else {
      // Gebruiker is UITGELOGD
      userMetaEl.textContent = "Niet ingelogd";
      
      if (mainApp) mainApp.classList.add("hidden");         // Verberg de app
      if (authSection) authSection.classList.remove("hidden"); // Toon inlogblok weer
      
      stopListener();
      transactions = [];
      draw();
    }
  });
}

function bindEvents() {
  form.addEventListener("submit", handleSubmit);
  authForm.addEventListener("submit", handleAuthSubmit);
  logoutBtn.addEventListener("click", handleLogout);
  if (googleLoginBtn) googleLoginBtn.addEventListener("click", handleGoogleLogin);
  tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if(!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === "delete") deleteDoc(doc(db, "users", currentUser.uid, "transactions", id));
      if (btn.dataset.action === "edit") {
          const tx = transactions.find(t => t.id === id);
          editingId = id;
          amountEl.value = tx.amount;
          categoryEl.value = tx.category;
          dateEl.value = tx.date;
          submitBtn.textContent = "Update";
      }
  });
  authModeButtons.forEach(btn => btn.addEventListener("click", () => {
    authMode = btn.dataset.authMode;
    authSubmitBtn.textContent = authMode === "login" ? "Inloggen" : "Registreren";
  }));
}

init();
