const TX_FEE = 0.005;
let currentToken = null;
let solPriceUSD = 0;
let displayPref = localStorage.getItem("displayPref") || "usd";

/* -------------- TABS ---------------- */
function switchTab(tabId){
  document.querySelectorAll(".tab-content").forEach(t=>t.style.display="none");
  document.getElementById(tabId).style.display="block";
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
  document.querySelector(`button[onclick*="${tabId}"]`).classList.add("active");
}

/* -------------- WALLET ---------------- */
function createUser(){
  const name = username.value.trim();
  if(!name) return;
  const wallet = {user:name, sol:1, tokens:{}};
  localStorage.setItem("wallet", JSON.stringify(wallet));
  localStorage.setItem("history", JSON.stringify([]));
  startApp();
}

function getWallet(){ return JSON.parse(localStorage.getItem("wallet")) || null; }
function saveWallet(w){ localStorage.setItem("wallet", JSON.stringify(w)); }

function startApp(){
  const w = getWallet();
  if(!w) return;
  loginBox.style.display="none";
  app.style.display="block";
  document.getElementById("displayPref").value = displayPref;
  refreshAll();
  setInterval(refreshAll, 5000);
}

function resetWallet(){
  const w = getWallet();
  w.sol = 1;
  w.tokens = {};
  saveWallet(w);
  refreshAll();
}

function updateBalance(){
  const w = getWallet();
  solBalance.innerText = `SOL: ${w.sol.toFixed(4)}`;
}

/* -------------- SETTINGS ---------------- */
function updateDisplayPref(){
  displayPref = document.getElementById("displayPref").value;
  localStorage.setItem("displayPref", displayPref);
  refreshAll();
}

/* -------------- GLOBAL REFRESH ---------------- */
async function refreshAll(){
  await fetchSolPrice();
  updateBalance();
  await refreshPortfolio();
  await refreshTradeUI();
  refreshHistory();
}

/* -------------- SOL PRICE ---------------- */
async function fetchSolPrice(){
  try{
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const d = await r.json();
    solPriceUSD = d.solana.usd;
  } catch(e){ console.log("Fehler Sol Price:", e);}
}

/* -------------- TOKEN SEARCH ---------------- */
async function searchToken(){
  const caVal = ca.value.trim();
  if(!caVal) return;
  try{
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${caVal}`);
    const data = await res.json();
    if(!data.pairs?.length) return alert("Token nicht gefunden");

    const p = data.pairs[0];
    currentToken = {
      ca: caVal,
      pair: p.pairAddress,
      name: p.baseToken.name,
      symbol: p.baseToken.symbol,
      icon: p.baseToken.logo || "",
      price: Number(p.priceUsd),
      liq: p.liquidity.usd,
      mcap: p.fdv
    };

    renderTokenUI();
    loadChart();
  } catch(e){ alert("Fehler beim Tokenladen"); console.log(e); }
}

/* -------------- RENDER TOKEN ---------------- */
function renderTokenUI(){
  if(!currentToken) return;
  tokenView.innerHTML = `
  <div class="card tradeBox">
    <h2>${currentToken.name} (${currentToken.symbol})</h2>
    <div id="tradeData"></div>
    <hr>
    PnL: <span id="tradePnL">0</span><br>
    Buy (SOL)<br><input id="buyAmount"><br>
    <button onclick="buyToken()">BUY</button>
    <hr>
    <div id="sellOptions">
      Sell <input id="sellInput" placeholder="Token oder %"><br>
      <button onclick="sellPercent(1)">100%</button>
      <button onclick="sellPercent(0.5)">50%</button>
      <button onclick="sellToken()">Custom</button>
    </div>
  </div>`;
  refreshTradeUI();
}

/* -------------- REFRESH TRADE ---------------- */
async function refreshTradeUI(){
  if(!currentToken) return;

  try{
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${currentToken.pair}`);
    const p = (await res.json()).pair;
    if(p){
      currentToken.price = Number(p.priceUsd);
      currentToken.liq = p.liquidity.usd;
      currentToken.mcap = p.fdv;
    }
  } catch(e){ console.log("Trade Refresh Fehler:", e); }

  if(document.getElementById("tradeData"))
    document.getElementById("tradeData").innerHTML =
      `Price: $${currentToken.price}<br>Liquidity: $${Math.floor(currentToken.liq)}<br>MarketCap: $${Math.floor(currentToken.mcap)}`;

  updateTradePnL();
  refreshPortfolio();
}

/* -------------- BUY / SELL ---------------- */
async function buyToken(){
  const w = getWallet();
  let sol = Number(document.getElementById("buyAmount").value);
  if(!sol || sol <= 0) return alert("Gib einen Betrag ein");
  if(sol + TX_FEE > w.sol) return alert("Nicht genug SOL");

  // Marktpreis zum Zeitpunkt des Kaufs abrufen
  let priceNow = currentToken.price;
  try{
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${currentToken.pair}`);
    const p = (await res.json()).pair;
    if(p) priceNow = Number(p.priceUsd);
  } catch(e){ console.log("Fehler beim Preis abrufen", e); }

  // korrekte Tokenmenge basierend auf investiertem SOL und Preis zum Kaufzeitpunkt
  const tokensReceived = sol / priceNow;

  w.sol -= sol + TX_FEE;

  if(!w.tokens[currentToken.ca])
    w.tokens[currentToken.ca] = {
      amount: 0,
      totalInvested: 0,
      name: currentToken.name,
      icon: currentToken.icon,
      avgPrice: 0
    };

  const token = w.tokens[currentToken.ca];

  // Update Tokenmenge und durchschnittlichen Kaufpreis für späteres PnL
  token.amount += tokensReceived;
  token.totalInvested += sol;
  token.avgPrice = token.totalInvested / token.amount; // avg SOL pro Token

  saveWallet(w);
  logHistory("BUY", currentToken.symbol, tokensReceived, priceNow);
  refreshAll();
}

function sellToken(){
  const w = getWallet();
  const t = w.tokens[currentToken.ca];
  if(!t) return;

  let val = parseFloat(document.getElementById("sellInput").value);
  if(!val || val<=0) return;
  val = Math.min(val, t.amount);

  const solReceived = val * currentToken.price;
  w.sol += solReceived - TX_FEE;

  // proportionale Reduktion totalInvested
  const fraction = val / t.amount;
  t.totalInvested -= t.totalInvested * fraction;

  t.amount -= val;
  if(t.amount<=0) delete w.tokens[currentToken.ca];

  saveWallet(w);
  logHistory("SELL", currentToken.symbol, val, currentToken.price);
  refreshAll();
}

function sellPercent(p){
  const w = getWallet();
  const t = w.tokens[currentToken.ca];
  if(!t) return;

  const val = t.amount * p;
  const solReceived = val * currentToken.price;
  w.sol += solReceived - TX_FEE;

  t.totalInvested -= t.totalInvested * p;
  t.amount -= val;
  if(t.amount<=0) delete w.tokens[currentToken.ca];

  saveWallet(w);
  logHistory("SELL", currentToken.symbol, val, currentToken.price);
  refreshAll();
}

/* -------------- TRADE PnL ---------------- */
function updateTradePnL(){
  if(!currentToken) return;
  const w = getWallet();
  const t = w.tokens[currentToken.ca];
  if(!t){ document.getElementById("tradePnL").innerText="0"; return; }

  const pnlSOL = (currentToken.price * t.amount) - t.totalInvested;
  const display = displayPref==="usd" ? `$${(pnlSOL*solPriceUSD).toFixed(2)}` : `${pnlSOL.toFixed(4)} SOL`;
  document.getElementById("tradePnL").innerText = display;
}

/* -------------- PORTFOLIO ---------------- */
async function refreshPortfolio(){
  const w = getWallet();
  portfolio.innerHTML = "";

  let totalSOL = w.sol;
  let totalUSD = w.sol*solPriceUSD;

  // SOL
  const solDiv = document.createElement("div");
  solDiv.className = "coin";
  solDiv.innerHTML = `<img src="https://cryptologos.cc/logos/solana-sol-logo.png"> ${w.sol.toFixed(4)} SOL`;
  portfolio.appendChild(solDiv);

  const entries = Object.entries(w.tokens);
  const requests = entries.map(([ca]) =>
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`)
      .then(r=>r.json())
      .catch(()=>null)
  );
  const results = await Promise.all(requests);

  entries.forEach(([ca,t],i)=>{
    const data = results[i];
    if(!data?.pairs?.length) return;

    const price = Number(data.pairs[0].priceUsd);
    t.price = price;

    const pnlSOL = (t.amount*price) - t.totalInvested;
    const displayPnl = displayPref==="usd" ? `$${(pnlSOL*solPriceUSD).toFixed(2)}` : `${pnlSOL.toFixed(4)} SOL`;

    // Total Worth: SOL im Wallet + investiertes SOL + PnL aller Tokens
    totalSOL += t.totalInvested + pnlSOL;
    totalUSD += (t.totalInvested + pnlSOL)*solPriceUSD;

    const div = document.createElement("div");
    div.className = "coin";
    div.innerHTML = `${t.icon?`<img src="${t.icon}">`:""} ${t.name} ${t.amount.toFixed(4)} | <span style="color:${pnlSOL>=0?'lime':'red'}">${displayPnl}</span>`;
    div.onclick = ()=>{
      document.getElementById("ca").value = ca;
      searchToken();
      switchTab("tradeTab");
    };
    portfolio.appendChild(div);
  });

  totalWorth.innerText = displayPref==="usd"
    ? `Total Worth: $${totalUSD.toFixed(2)}`
    : `Total Worth: ${totalSOL.toFixed(4)} SOL`;
}

/* -------------- HISTORY ---------------- */
function logHistory(type,symbol,amount,price){
  const hist = JSON.parse(localStorage.getItem("history")||"[]");
  hist.push({type,symbol,amount,price,date:new Date().toLocaleString()});
  localStorage.setItem("history", JSON.stringify(hist));
}

function refreshHistory(){
  const box = document.getElementById("history");
  box.innerHTML = "";
  const hist = JSON.parse(localStorage.getItem("history")||"[]");
  if(hist.length===0){ box.innerHTML="<div class='coin'>Keine Trades</div>"; return; }
  hist.slice().reverse().forEach(h=>{
    const div=document.createElement("div");
    div.className="coin";
    div.innerHTML=`${h.date}: ${h.type} ${h.amount.toFixed(4)} ${h.symbol} @ $${h.price.toFixed(6)}`;
    box.appendChild(div);
  });
}

/* -------------- CHART ---------------- */
function loadChart(){
  if(!currentToken) return;
  chartFrame.src = `https://dexscreener.com/solana/${currentToken.pair}?embed=1`;
  chartTitle.innerText = `${currentToken.name} Chart`;
}