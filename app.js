const TX_FEE = 0.005;
let currentToken = null;
let solPriceUSD = 0;
let displayPref = localStorage.getItem("displayPref") || "usd";
const MAX_PRICE_IMPACT = 0.10;   // 10% Cap (ändern wenn du willst)
const BASE_SLIPPAGE = 0.1;     // 10% Grundslippage

/* ------------------ TABS ------------------ */
function switchTab(tabId){
  document.querySelectorAll(".tab-content").forEach(t => t.style.display="none");
  document.getElementById(tabId).style.display="block";
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`button[onclick*="${tabId}"]`).classList.add("active");
}

/* ------------------ WALLET ------------------ */
function createUser(){
  const name = username.value.trim();
  if(!name) return;
  const wallet = {user:name, sol:1, tokens:{}};
  saveWallet(wallet);
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
  setInterval(refreshAll, 2000); // öfter auto refresh
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

/* ------------------ SETTINGS ------------------ */
function updateDisplayPref(){
  displayPref = document.getElementById("displayPref").value;
  localStorage.setItem("displayPref", displayPref);
  refreshAll();
}

/* ------------------ GLOBAL REFRESH ------------------ */
async function refreshAll(){
  await fetchSolPrice();
  updateBalance();
  await refreshPortfolio();
  await refreshTradeUI();
  refreshHistory();
}

/* ------------------ SOL PRICE ------------------ */
async function fetchSolPrice(){
  try{
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const d = await r.json();
    solPriceUSD = d.solana.usd;
  }catch(e){}
}

/* ------------------ TOKEN SEARCH ------------------ */
async function searchToken(){
  const caVal = ca.value.trim();
  if(!caVal) return;

  let found = false;

  // 1️⃣ DexScreener zuerst
  try{
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${caVal}`);
    const data = await res.json();

    if(data.pairs?.length){
      const p = data.pairs[0];
      currentToken = {
        ca: caVal,
        pair: p.pairAddress,
        name: p.baseToken.name,
        symbol: p.baseToken.symbol,
        icon: p.baseToken.logo || "",
        price: Number(p.priceUsd),
        liq: p.liquidity.usd,
        mcap: p.fdv,
        source: "dexscreener"
      };
      found = true;
    }
  }catch(e){ console.log("DexScreener Error:", e); }

  // 2️⃣ PumpFun fallback
  if(!found){
    try{
      // Simuliert PumpFun API / Profil
      const resPF = await fetch(`https://api.pumpfun.io/token/${caVal}`);
      const pf = await resPF.json();
      
      currentToken = {
        ca: caVal,
        pair: null,                 // kein Dex-Pair
        name: pf.name || caVal,
        symbol: pf.symbol || caVal.slice(0,4).toUpperCase(),
        icon: pf.icon || "",
        price: pf.priceUsd || 0.001, // Default minimal Price
        liq: pf.liquidityUsd || 0,
        mcap: pf.marketCapUsd || 0,
        source: "pumpfun"
      };
      found = true;
    }catch(e){ console.log("PumpFun Error:", e); }
  }

  if(!found) return alert("Token nicht gefunden");

  renderTokenUI();
  loadChart();
}

/* ------------------ RENDER TOKEN ------------------ */
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
    <button onclick="refreshTradeUI()">Refresh Token</button>
  </div>`;
  refreshTradeUI();
}

/* ------------------ REFRESH TRADE ------------------ */
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
  }catch(e){}

  if(document.getElementById("tradeData"))
    document.getElementById("tradeData").innerHTML =
      `Price: $${currentToken.price}<br>Liquidity: $${Math.floor(currentToken.liq)}<br>MarketCap: $${Math.floor(currentToken.mcap)}`;

  updateTradePnL();
}

/* ------------------ SWAP ------------------ */
function simulateSwap(solAmount, liquidityUSD, priceUSD, isBuy){
  if(!liquidityUSD || liquidityUSD <= 0) return {tokens:0, avgPrice:priceUSD};

  const tradeUSD = solAmount * solPriceUSD;

  // Trade darf nicht mehr als 50% der Liquidity sein
  const maxTradeUSD = liquidityUSD * 0.5;
  if(tradeUSD > maxTradeUSD) return {tokens:0, avgPrice:priceUSD};

  // Pool Größen (vereinfacht: Hälfte Token / Hälfte USD)
  const poolUSD = liquidityUSD / 2;
  const poolToken = poolUSD / priceUSD;
  if(poolToken <= 0) return {tokens:0, avgPrice:priceUSD};

  // Preisimpact (Trade vs Pool)
  let priceImpact = tradeUSD / (poolUSD + tradeUSD);
  if(priceImpact > MAX_PRICE_IMPACT) priceImpact = MAX_PRICE_IMPACT;

  const slippage = BASE_SLIPPAGE + priceImpact;

  let newPrice;
  if(isBuy){
    newPrice = priceUSD * (1 + priceImpact);
  } else {
    newPrice = priceUSD * (1 - priceImpact);
  }

  const avgPrice = (priceUSD + newPrice) / 2 * (1 + slippage);

  const tokens = tradeUSD / avgPrice;

  return {tokens, avgPrice};
}
/* ------------------ BUY ------------------ */
async function buyToken(){
  const w = getWallet();
  let sol = Number(document.getElementById("buyAmount").value);

  if(!sol || sol <= 0) return;
  if(sol + TX_FEE > w.sol) return alert("Nicht genug SOL");

  await fetchSolPrice();
  await refreshTradeUI();

  const liq = currentToken.liq;
  const priceUSD = currentToken.price;

  const swap = simulateSwap(sol, liq, priceUSD, true);

  if(swap.tokens <= 0) return alert("Trade zu groß für die vorhandene Liquidity");

  const tokensReceived = swap.tokens;
  const avgPriceUSD = swap.avgPrice;

  w.sol -= sol + TX_FEE;

  if(!w.tokens[currentToken.ca]){
    w.tokens[currentToken.ca] = {
      amount: 0,
      totalInvested: 0,
      name: currentToken.name,
      icon: currentToken.icon
    };
  }

  const t = w.tokens[currentToken.ca];
  t.amount += tokensReceived;
  t.totalInvested += sol;

  saveWallet(w);
  logHistory("BUY", currentToken.symbol, tokensReceived, avgPriceUSD, 0);
  await refreshAll();
}

/* ------------------ SELL ------------------ */
function sellCore(tokenAmount){
  const w = getWallet();
  const t = w.tokens[currentToken.ca];
  if(!t || tokenAmount <= 0) return;

  const sellAmount = Math.min(tokenAmount, t.amount);

  const liq = currentToken.liq;
  const priceUSD = currentToken.price;

  // SOL Wert des Verkaufs
  const tokenValueUSD = sellAmount * priceUSD;
  const solValue = tokenValueUSD / solPriceUSD;

  const swap = simulateSwap(solValue, liq, priceUSD, false);

  const avgPriceUSD = swap.avgPrice;
  const solReceived = (sellAmount * avgPriceUSD) / solPriceUSD;

  const investedPart = t.totalInvested * (sellAmount / t.amount);
  const pnlSOL = solReceived - investedPart;

  w.sol += solReceived - TX_FEE;

  t.totalInvested -= investedPart;
  t.amount -= sellAmount;
  if(t.amount <= 0) delete w.tokens[currentToken.ca];

  saveWallet(w);

  logHistory("SELL", currentToken.symbol, sellAmount, avgPriceUSD, pnlSOL);

  refreshAll();
}

function sellToken(){
  const val = parseFloat(document.getElementById("sellInput").value);
  if(!val || val <= 0) return;
  sellCore(val);
}

function sellPercent(p){
  const w = getWallet();
  const t = w.tokens[currentToken.ca];
  if(!t) return;
  sellCore(t.amount * p);
}

/* ------------------ TRADE PNL ------------------ */
function updateTradePnL(){
  if(!currentToken) return;
  const w = getWallet();
  const t = w.tokens[currentToken.ca];
  const tradePnLSpan = document.getElementById("tradePnL");

  if(!t || t.amount <= 0){
    tradePnLSpan.innerText = displayPref === "usd" ? "$0.00" : "0 SOL";
    tradePnLSpan.style.color = "white";
    document.getElementById("sellOptions").style.display = "none";
    return;
  }

  // Sicherstellen, dass Werte gesetzt sind
  const priceUSD = currentToken.price || 0;
  const solAmount = t.amount || 0;
  const investedSOL = t.totalInvested || 0;
  const solPrice = solPriceUSD || 0;

  // Aktueller Wert in SOL
  const tokenPriceSOL = solPrice > 0 ? priceUSD / solPrice : 0;
  const valueNowSOL = solAmount * tokenPriceSOL;

  // PnL
  const pnlSOL = valueNowSOL - investedSOL;

  // Anzeige abhängig von Einstellung
  let display;
  if(displayPref === "usd"){
    display = solPrice > 0 ? `$${(pnlSOL * solPrice).toFixed(2)}` : "$0.00";
  } else {
    display = `${pnlSOL.toFixed(4)} SOL`;
  }

  tradePnLSpan.innerText = display;
  tradePnLSpan.style.color = pnlSOL >= 0 ? "lime" : "red";

  // Sell-Option nur wenn Token vorhanden
  document.getElementById("sellOptions").style.display = solAmount > 0 ? "block" : "none";
}

/* ------------------ PORTFOLIO ------------------ */
async function refreshPortfolio(){
  const w = getWallet();
  portfolio.innerHTML = "";

  let totalSOL = w.sol; // Start mit SOL im Wallet
  let totalPnlSOL = 0;

  // SOL selbst
  const solDiv = document.createElement("div");
  solDiv.className="coin";
  solDiv.innerHTML = `<img src="https://cryptologos.cc/logos/solana-sol-logo.png"> ${w.sol.toFixed(4)} SOL`;
  portfolio.appendChild(solDiv);

  // Tokens
  for(const tokenCA in w.tokens){
    const t = w.tokens[tokenCA];

    // Aktuellen Live Preis abrufen
    try{
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenCA}`);
      const p = (await res.json()).pairs[0];
      if(p) t.price = Number(p.priceUsd);
    }catch(e){}

    const tokenPriceSOL = t.price / solPriceUSD;
    const valueNowSOL = t.amount * tokenPriceSOL;        // Aktueller SOL-Wert
    const pnlSOL = valueNowSOL - t.totalInvested;       // PnL in SOL

    totalSOL += valueNowSOL;                            // Total SOL inkl Token
    totalPnlSOL += pnlSOL;

    const div = document.createElement("div");
    div.className = "coin";
    div.innerHTML = `${t.name} ${t.amount.toFixed(4)} | 
      <span style="color:${pnlSOL>=0?'lime':'red'}">
        ${displayPref==="usd" ? `$${(pnlSOL*solPriceUSD).toFixed(2)}` : `${pnlSOL.toFixed(4)} SOL`}
      </span>`;

    // Klick öffnet Trade wieder
    div.onclick = async () => {
      document.getElementById("ca").value = tokenCA;
      await searchToken();
      switchTab("tradeTab");
    };

    portfolio.appendChild(div);
  }

  // Total Worth anzeigen
  totalWorth.innerText = displayPref === "usd"
    ? `Total Worth: $${(totalSOL*solPriceUSD).toFixed(2)}`
    : `Total Worth: ${totalSOL.toFixed(4)} SOL`;
}

function renderPortfolio(){
  const w = getWallet();
  const box = document.getElementById("portfolioList");
  box.innerHTML = "";

  let totalWorth = w.sol;
  let totalPnl = 0;

  Object.keys(w.tokens).forEach(ca=>{
    const t = w.tokens[ca];
    const live = prices[ca] || {price:0};

    const valueNow = t.amount * live.price;
    const pnl = valueNow - t.totalInvested;

    totalWorth += valueNow;
    totalPnl += pnl;

    const row = document.createElement("div");
    row.className = "tokenRow";

    const pnlColor = pnl >= 0 ? "#00c853" : "#ff3b30";
    const pnlSign = pnl >= 0 ? "+" : "";

    row.innerHTML = `
      <img src="${t.icon}" class="tokenIcon">
      <div class="tokenInfo">
        <div class="tokenName">${t.name}</div>
        <div class="tokenAmount">${t.amount.toFixed(4)}</div>
      </div>
      <div class="tokenRight">
        <div>${valueNow.toFixed(4)} SOL</div>
        ${t.name !== "Solana" ? `<div style="color:${pnlColor}">${pnlSign}${pnl.toFixed(4)} SOL</div>` : ``}
      </div>
    `;

    // WICHTIG: Klick öffnet Trade wieder
    row.onclick = () => {
      openTrade(ca);
    };

    box.appendChild(row);
  });

  const totalBox = document.getElementById("totalWorth");

  const pnlColor = totalPnl >= 0 ? "#00c853" : "#ff3b30";
  const pnlSign = totalPnl >= 0 ? "+" : "";

  totalBox.innerHTML = `
    ${totalWorth.toFixed(4)} SOL
    <span style="color:${pnlColor}">
      (${pnlSign}${totalPnl.toFixed(4)} SOL)
    </span>
  `;
}

/* ------------------ HISTORY ------------------ */
function logHistory(type,symbol,amount,price,pnlSOL){
  const hist = JSON.parse(localStorage.getItem("history")||"[]");
  hist.push({type,symbol,amount,price,pnlSOL,date:new Date().toLocaleString()});
  localStorage.setItem("history", JSON.stringify(hist));
}

function refreshHistory(){
  const box = document.getElementById("history");
  box.innerHTML="";
  const hist = JSON.parse(localStorage.getItem("history")||"[]");
  if(hist.length===0){ box.innerHTML="<div class='coin'>Keine Trades</div>"; return; }

  hist.slice().reverse().forEach(h=>{
    const color = h.type==="SELL" ? (h.pnlSOL>=0?"lime":"red") : "white";
    const div=document.createElement("div");
    div.className="coin";
    div.innerHTML=`<span style="color:${color}">
    ${h.date}: ${h.type} ${h.amount.toFixed(4)} ${h.symbol} @ $${h.price.toFixed(6)}
    </span>`;
    box.appendChild(div);
  });
}

/* ------------------ CHART ------------------ */
function loadChart(){
  if(!currentToken) return;

  if(currentToken.source === "dexscreener" && currentToken.pair){
    chartFrame.src = `https://dexscreener.com/solana/${currentToken.pair}?embed=1`;
  } else if(currentToken.source === "pumpfun") {
    chartFrame.src = `https://pumpfun.io/token/${currentToken.ca}/chart?embed=1`;
  }

  chartTitle.innerText = `${currentToken.name} Chart`;
}

/* ------------------ AUTO LOAD WALLET ------------------ */
window.addEventListener("load", ()=>{
  if(getWallet()) startApp();
});
