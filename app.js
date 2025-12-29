import { dbApi } from "./db.js";

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const fmtBRL = (n) =>
  (Number(n || 0)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const uid = () => crypto.randomUUID?.() || (Date.now() + "-" + Math.random().toString(16).slice(2));
const nowISO = () => new Date().toISOString();
const toDateInput = (d) => new Date(d).toISOString().slice(0, 10);

function parseMoney(str) {
  if (typeof str === "number") return str;
  const s = String(str || "").trim();
  if (!s) return 0;
  // aceita "12,50" ou "12.50" ou "R$ 12,50"
  const clean = s.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const v = Number(clean);
  return Number.isFinite(v) ? v : 0;
}

function setStatus(msg, ok = true) {
  $("#statusText").textContent = msg;
  $("#dotSync").style.background = ok ? "#2ecc71" : "#ff4d4d";
  $("#dotSync").style.boxShadow = ok ? "0 0 0 6px rgba(46,204,113,.12)" : "0 0 0 6px rgba(255,77,77,.14)";
}

// State
let products = [];
let sales = [];
let cash = [];
let stockMoves = [];
let editingProductId = null;

let currentSale = {
  customer: "",
  payment: "Dinheiro",
  items: [], // {productId, name, qty, price, cost, total, profit}
};

function calcSaleTotals() {
  const total = currentSale.items.reduce((a, i) => a + i.total, 0);
  const profit = currentSale.items.reduce((a, i) => a + i.profit, 0);
  $("#saleTotal").textContent = fmtBRL(total);
  $("#saleProfit").textContent = fmtBRL(profit);
}

function refreshDatalist() {
  const dl = $("#productsDatalist");
  dl.innerHTML = "";
  for (const p of products) {
    const o = document.createElement("option");
    o.value = `${p.name}${p.sku ? " • " + p.sku : ""}`;
    dl.appendChild(o);
  }
}

function findProductByInput(text) {
  const t = (text || "").toLowerCase();
  const byName = products.find((p) => p.name.toLowerCase() === t);
  if (byName) return byName;
  const bySku = products.find((p) => (p.sku || "").toLowerCase() === t);
  if (bySku) return bySku;
  // tenta contém
  return products.find((p) =>
    (p.name + " " + (p.sku || "") + " " + (p.category || "")).toLowerCase().includes(t)
  );
}

function safeStock(p, delta) {
  const newStock = Math.max(0, Number(p.stock || 0) + Number(delta || 0));
  p.stock = newStock;
  return p;
}

function productMargin(p) {
  const cost = Number(p.cost || 0);
  const price = Number(p.price || 0);
  if (price <= 0) return 0;
  return ((price - cost) / price) * 100;
}

// Rendering
function renderProducts() {
  const q = ($("#searchProduct").value || "").toLowerCase().trim();
  const tbody = $("#productsTbody");
  tbody.innerHTML = "";

  const filtered = products
    .filter((p) => {
      if (!q) return true;
      const hay = `${p.name} ${p.sku || ""} ${p.category || ""} ${p.supplier || ""}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const p of filtered) {
    const tr = document.createElement("tr");

    const low = Number(p.stock || 0) <= Number(p.minStock || 0);

    tr.innerHTML = `
      <td>
        <div><strong>${escapeHtml(p.name)}</strong></div>
        <div class="muted">${escapeHtml(p.sku || "")}${p.sku ? " • " : ""}${escapeHtml(p.supplier || "")}</div>
      </td>
      <td>${escapeHtml(p.category || "-")}</td>
      <td>${Number(p.stock || 0)}</td>
      <td>${Number(p.minStock || 0)}</td>
      <td>${fmtBRL(p.cost || 0)}</td>
      <td>${fmtBRL(p.price || 0)}</td>
      <td>
        <span class="pill ${low ? "low" : ""}">
          ${low ? "⚠️" : "✅"} ${productMargin(p).toFixed(0)}%
        </span>
      </td>
      <td style="white-space:nowrap; text-align:right;">
        <button class="iconBtn" data-edit="${p.id}">Editar</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // bind edit
  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openProductModal(btn.getAttribute("data-edit")));
  });
}

function renderLowStock() {
  const q = ($("#searchLow").value || "").toLowerCase().trim();
  const box = $("#lowStockList");
  box.innerHTML = "";

  const lows = products
    .filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0))
    .filter((p) => {
      if (!q) return true;
      return (p.name + " " + (p.category || "") + " " + (p.sku || "")).toLowerCase().includes(q);
    })
    .sort((a, b) => (Number(a.stock) - Number(b.stock)));

  if (lows.length === 0) {
    box.innerHTML = `<div class="hint">Sem alertas agora. Glamour no controle. ✨</div>`;
    return;
  }

  for (const p of lows) {
    const need = Math.max(0, Number(p.minStock || 0) - Number(p.stock || 0));
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div class="muted">${escapeHtml(p.category || "Sem categoria")} • Estoque: ${Number(p.stock || 0)} • Alerta: ${Number(p.minStock || 0)}</div>
      </div>
      <div style="text-align:right;">
        <div class="pill low">Repor +${need}</div>
      </div>
    `;
    box.appendChild(div);
  }
}

function renderSaleItems() {
  const tbody = $("#saleItemsTbody");
  tbody.innerHTML = "";
  for (const [idx, it] of currentSale.items.entries()) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(it.name)}</strong></td>
      <td>${it.qty}</td>
      <td>${fmtBRL(it.price)}</td>
      <td>${fmtBRL(it.total)}</td>
      <td>${fmtBRL(it.profit)}</td>
      <td style="text-align:right;">
        <button class="iconBtn" data-rm="${idx}">Remover</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("[data-rm]").forEach((b) => {
    b.addEventListener("click", () => {
      const idx = Number(b.getAttribute("data-rm"));
      currentSale.items.splice(idx, 1);
      renderSaleItems();
      calcSaleTotals();
    });
  });
}

function renderSalesTable() {
  const tbody = $("#salesTbody");
  tbody.innerHTML = "";

  const from = $("#salesFrom").value ? new Date($("#salesFrom").value).getTime() : null;
  const to = $("#salesTo").value ? new Date($("#salesTo").value).getTime() + 86400000 - 1 : null;
  const q = ($("#salesSearch").value || "").toLowerCase().trim();

  const filtered = sales
    .filter((s) => {
      const t = new Date(s.createdAt).getTime();
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      if (!q) return true;
      const hay = `${s.customer || ""} ${s.payment} ${s.items.map(i => i.name).join(" ")}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  for (const s of filtered) {
    const itemsLabel = s.items.map(i => `${i.qty}x ${i.name}`).join(", ");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTime(s.createdAt)}</td>
      <td>${escapeHtml(s.customer || "-")}</td>
      <td title="${escapeHtml(itemsLabel)}">${escapeHtml(truncate(itemsLabel, 70))}</td>
      <td>${fmtBRL(s.total)}</td>
      <td>${fmtBRL(s.profit)}</td>
      <td>${escapeHtml(s.payment)}</td>
      <td style="text-align:right;">
        <button class="iconBtn" data-del-sale="${s.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("[data-del-sale]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-del-sale");
      if (!confirm("Excluir essa venda? (isso não repõe estoque automaticamente)")) return;
      await dbApi.del(dbApi.STORES.sales, id);
      sales = sales.filter((x) => x.id !== id);
      setStatus("Venda excluída.", true);
      await refreshAll();
    });
  });
}

function renderCashTable() {
  const tbody = $("#cashTbody");
  tbody.innerHTML = "";

  const from = $("#cashFrom").value ? new Date($("#cashFrom").value).getTime() : null;
  const to = $("#cashTo").value ? new Date($("#cashTo").value).getTime() + 86400000 - 1 : null;
  const q = ($("#cashSearch").value || "").toLowerCase().trim();

  const filtered = cash
    .filter((c) => {
      const t = new Date(c.createdAt).getTime();
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      if (!q) return true;
      const hay = `${c.type} ${c.desc} ${c.origin || ""}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  let inSum = 0, outSum = 0;
  for (const c of filtered) {
    if (c.type === "Entrada") inSum += Number(c.value || 0);
    else outSum += Number(c.value || 0);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTime(c.createdAt)}</td>
      <td>${escapeHtml(c.type)}</td>
      <td>${escapeHtml(c.desc)}</td>
      <td>${fmtBRL(c.value)}</td>
      <td>${escapeHtml(c.origin || "-")}</td>
      <td style="text-align:right;">
        <button class="iconBtn" data-del-cash="${c.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  $("#cashIn").textContent = fmtBRL(inSum);
  $("#cashOut").textContent = fmtBRL(outSum);
  $("#cashBalance").textContent = fmtBRL(inSum - outSum);

  tbody.querySelectorAll("[data-del-cash]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-del-cash");
      if (!confirm("Excluir esse lançamento do caixa?")) return;
      await dbApi.del(dbApi.STORES.cash, id);
      cash = cash.filter((x) => x.id !== id);
      setStatus("Lançamento excluído.", true);
      await refreshAll();
    });
  });
}

function renderDashboard() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const end = start + 86400000 - 1;

  const todays = sales.filter((s) => {
    const t = new Date(s.createdAt).getTime();
    return t >= start && t <= end;
  });

  const count = todays.length;
  const revenue = todays.reduce((a, s) => a + Number(s.total || 0), 0);
  const profit = todays.reduce((a, s) => a + Number(s.profit || 0), 0);

  $("#kpiSalesCount").textContent = String(count);
  $("#kpiRevenue").textContent = fmtBRL(revenue);
  $("#kpiProfit").textContent = fmtBRL(profit);

  // last sales
  const tbody = $("#recentSalesTbody");
  tbody.innerHTML = "";
  todays
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${new Date(s.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
        <td>${escapeHtml(truncate(s.items.map(i => `${i.qty}x ${i.name}`).join(", "), 60))}</td>
        <td>${fmtBRL(s.total)}</td>
        <td>${escapeHtml(s.payment)}</td>
        <td>${fmtBRL(s.profit)}</td>
      `;
      tbody.appendChild(tr);
    });

  renderLowStock();
}

function renderReports() {
  const fromV = $("#repFrom").value;
  const toV = $("#repTo").value;
  const from = fromV ? new Date(fromV).getTime() : null;
  const to = toV ? new Date(toV).getTime() + 86400000 - 1 : null;

  const filtered = sales.filter((s) => {
    const t = new Date(s.createdAt).getTime();
    if (from !== null && t < from) return false;
    if (to !== null && t > to) return false;
    return true;
  });

  const revenue = filtered.reduce((a, s) => a + Number(s.total || 0), 0);
  const profit = filtered.reduce((a, s) => a + Number(s.profit || 0), 0);
  const count = filtered.length;
  const avg = count ? revenue / count : 0;

  $("#repRevenue").textContent = fmtBRL(revenue);
  $("#repProfit").textContent = fmtBRL(profit);
  $("#repCount").textContent = String(count);
  $("#repAvg").textContent = fmtBRL(avg);

  // top products by revenue
  const map = new Map();
  for (const s of filtered) {
    for (const it of s.items) {
      const key = it.productId || it.name;
      const cur = map.get(key) || { name: it.name, rev: 0, qty: 0, profit: 0 };
      cur.rev += Number(it.total || 0);
      cur.qty += Number(it.qty || 0);
      cur.profit += Number(it.profit || 0);
      map.set(key, cur);
    }
  }
  const top = Array.from(map.values()).sort((a, b) => b.rev - a.rev).slice(0, 10);
  const topBox = $("#topProductsList");
  topBox.innerHTML = top.length ? "" : `<div class="hint">Sem dados no período.</div>`;
  for (const t of top) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div>
        <strong>${escapeHtml(t.name)}</strong>
        <div class="muted">Qtd: ${t.qty} • Lucro: ${fmtBRL(t.profit)}</div>
      </div>
      <div><strong>${fmtBRL(t.rev)}</strong></div>
    `;
    topBox.appendChild(div);
  }

  // restock suggestions: low stock + top sellers
  const suggest = products
    .filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0))
    .map((p) => {
      const sold = top.find((x) => x.name === p.name)?.qty || 0;
      const need = Math.max(0, Number(p.minStock || 0) - Number(p.stock || 0));
      return { p, sold, need };
    })
    .sort((a, b) => (b.sold - a.sold) || (b.need - a.need));

  const sugBox = $("#restockSuggestList");
  sugBox.innerHTML = suggest.length ? "" : `<div class="hint">Nenhum produto em alerta no momento.</div>`;
  for (const s of suggest) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div>
        <strong>${escapeHtml(s.p.name)}</strong>
        <div class="muted">Estoque: ${s.p.stock} • Alerta: ${s.p.minStock} • Vendidos no período: ${s.sold}</div>
      </div>
      <div style="text-align:right;">
        <div class="pill low">Repor +${s.need}</div>
      </div>
    `;
    sugBox.appendChild(div);
  }
}

// Modal produto
function openProductModal(id = null) {
  editingProductId = id;
  const m = $("#productModal");
  $("#productModalTitle").textContent = id ? "Editar produto" : "Novo produto";
  $("#btnDeleteProduct").hidden = !id;

  const p = id ? products.find((x) => x.id === id) : null;

  $("#pName").value = p?.name || "";
  $("#pCategory").value = p?.category || "";
  $("#pSku").value = p?.sku || "";
  $("#pStock").value = p?.stock ?? 0;
  $("#pMin").value = p?.minStock ?? 0;
  $("#pCost").value = p ? String(p.cost ?? 0).replace(".", ",") : "";
  $("#pPrice").value = p ? String(p.price ?? 0).replace(".", ",") : "";
  $("#pSupplier").value = p?.supplier || "";
  $("#pNotes").value = p?.notes || "";

  m.showModal();
}

async function saveProduct() {
  const name = $("#pName").value.trim();
  if (!name) return alert("Nome do produto é obrigatório.");

  const product = {
    id: editingProductId || uid(),
    name,
    category: $("#pCategory").value.trim(),
    sku: $("#pSku").value.trim(),
    stock: Number($("#pStock").value || 0),
    minStock: Number($("#pMin").value || 0),
    cost: parseMoney($("#pCost").value),
    price: parseMoney($("#pPrice").value),
    supplier: $("#pSupplier").value.trim(),
    notes: $("#pNotes").value.trim(),
    updatedAt: nowISO(),
    createdAt: editingProductId ? (products.find(p => p.id === editingProductId)?.createdAt || nowISO()) : nowISO(),
  };

  await dbApi.put(dbApi.STORES.products, product);
  setStatus("Produto salvo.", true);

  $("#productModal").close();
  await refreshAll();
}

async function deleteProduct() {
  if (!editingProductId) return;
  if (!confirm("Excluir este produto?")) return;

  await dbApi.del(dbApi.STORES.products, editingProductId);
  setStatus("Produto excluído.", true);
  $("#productModal").close();
  await refreshAll();
}

// Vendas
function syncSaleFormToState() {
  currentSale.customer = $("#saleCustomer").value.trim();
  currentSale.payment = $("#salePayment").value;
}

function clearSale() {
  currentSale = { customer: "", payment: "Dinheiro", items: [] };
  $("#saleCustomer").value = "";
  $("#salePayment").value = "Dinheiro";
  $("#saleAddProduct").value = "";
  $("#saleItemQty").value = 1;
  renderSaleItems();
  calcSaleTotals();
}

function addItemToSale() {
  syncSaleFormToState();

  const text = $("#saleAddProduct").value.trim();
  const qty = Math.max(1, Number($("#saleItemQty").value || 1));
  if (!text) return;

  const p = findProductByInput(text);
  if (!p) return alert("Não achei esse produto. Confere o nome/SKU ou cadastra ele em Produtos.");

  const price = Number(p.price || 0);
  const cost = Number(p.cost || 0);
  const total = price * qty;
  const profit = (price - cost) * qty;

  currentSale.items.push({
    productId: p.id,
    name: p.name,
    qty,
    price,
    cost,
    total,
    profit,
  });

  $("#saleAddProduct").value = "";
  $("#saleItemQty").value = 1;

  renderSaleItems();
  calcSaleTotals();
}

async function saveSale() {
  syncSaleFormToState();

  if (currentSale.items.length === 0) return alert("Adiciona pelo menos 1 item.");
  // checa estoque
  for (const it of currentSale.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p) return alert(`Produto não encontrado: ${it.name}`);
    if (Number(p.stock || 0) < it.qty) {
      return alert(`Estoque insuficiente de "${p.name}". Estoque atual: ${p.stock}`);
    }
  }

  const total = currentSale.items.reduce((a, i) => a + i.total, 0);
  const profit = currentSale.items.reduce((a, i) => a + i.profit, 0);

  const sale = {
    id: uid(),
    createdAt: nowISO(),
    customer: currentSale.customer,
    payment: currentSale.payment,
    items: currentSale.items.map((i) => ({ ...i })),
    total,
    profit,
  };

  // baixa estoque + registra movimento
  for (const it of sale.items) {
    const p = products.find((x) => x.id === it.productId);
    safeStock(p, -it.qty);
    p.updatedAt = nowISO();
    await dbApi.put(dbApi.STORES.products, p);

    await dbApi.put(dbApi.STORES.stockMoves, {
      id: uid(),
      createdAt: nowISO(),
      productId: p.id,
      productName: p.name,
      delta: -it.qty,
      note: `Venda (${sale.payment})`,
      origin: "Venda",
      refId: sale.id,
    });
  }

  // lança no caixa (entrada automática)
  await dbApi.put(dbApi.STORES.cash, {
    id: uid(),
    createdAt: sale.createdAt,
    type: "Entrada",
    desc: `Venda (${sale.payment})${sale.customer ? " - " + sale.customer : ""}`,
    value: sale.total,
    origin: "Venda",
    refId: sale.id,
  });

  await dbApi.put(dbApi.STORES.sales, sale);

  setStatus("Venda salva + caixa atualizado.", true);
  clearSale();
  await refreshAll();
}

// Caixa
async function addCash() {
  const type = $("#cashType").value;
  const desc = $("#cashDesc").value.trim();
  const value = parseMoney($("#cashValue").value);

  if (!desc) return alert("Descrição é obrigatória.");
  if (value <= 0) return alert("Valor precisa ser maior que zero.");

  const entry = {
    id: uid(),
    createdAt: nowISO(),
    type,
    desc,
    value,
    origin: "Manual",
  };

  await dbApi.put(dbApi.STORES.cash, entry);
  $("#cashDesc").value = "";
  $("#cashValue").value = "";
  setStatus("Lançamento adicionado.", true);
  await refreshAll();
}

// Estoque rápido
async function applyStockMove() {
  const sku = $("#stockSku").value.trim().toLowerCase();
  const name = $("#stockName").value.trim().toLowerCase();
  const qty = Number($("#stockQty").value || 0);
  const note = $("#stockNote").value.trim();

  if (!name) return alert("Nome do produto é obrigatório.");
  if (!qty || !Number.isFinite(qty)) return alert("Quantidade inválida. Use número (ex.: 5 ou -2).");

  let p = null;
  if (sku) p = products.find((x) => (x.sku || "").toLowerCase() === sku);
  if (!p) p = products.find((x) => x.name.toLowerCase() === name);
  if (!p) return alert("Produto não encontrado. Dica: use o nome exato ou cadastre antes.");

  safeStock(p, qty);
  p.updatedAt = nowISO();
  await dbApi.put(dbApi.STORES.products, p);

  await dbApi.put(dbApi.STORES.stockMoves, {
    id: uid(),
    createdAt: nowISO(),
    productId: p.id,
    productName: p.name,
    delta: qty,
    note: note || "Ajuste de estoque",
    origin: "Estoque",
  });

  $("#stockSku").value = "";
  $("#stockName").value = "";
  $("#stockQty").value = "";
  $("#stockNote").value = "";
  setStatus("Estoque ajustado.", true);
  await refreshAll();
}

// Backup / Restore
async function doBackup() {
  const payload = {
    app: "Glamour Makeup",
    exportedAt: nowISO(),
    version: 1,
    data: {
      products,
      sales,
      cash,
      stockMoves,
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `glamour-makeup-backup-${toDateInput(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setStatus("Backup gerado.", true);
}

async function doRestore(file) {
  const text = await file.text();
  const payload = JSON.parse(text);

  if (!payload?.data) return alert("Arquivo inválido.");
  if (!confirm("Restaurar backup? Isso sobrescreve os dados atuais do app.")) return;

  await dbApi.clear(dbApi.STORES.products);
  await dbApi.clear(dbApi.STORES.sales);
  await dbApi.clear(dbApi.STORES.cash);
  await dbApi.clear(dbApi.STORES.stockMoves);

  const p = payload.data.products || [];
  const s = payload.data.sales || [];
  const c = payload.data.cash || [];
  const m = payload.data.stockMoves || [];

  await dbApi.bulkPut(dbApi.STORES.products, p);
  await dbApi.bulkPut(dbApi.STORES.sales, s);
  await dbApi.bulkPut(dbApi.STORES.cash, c);
  await dbApi.bulkPut(dbApi.STORES.stockMoves, m);

  setStatus("Backup restaurado.", true);
  await refreshAll();
}

// Exports CSV
function exportCsv(filename, rows) {
  const escape = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportSalesCsv() {
  const rows = [["data", "cliente", "pagamento", "total", "lucro", "itens"]];
  for (const s of sales.slice().sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))) {
    rows.push([
      s.createdAt,
      s.customer || "",
      s.payment,
      s.total,
      s.profit,
      s.items.map(i => `${i.qty}x ${i.name}`).join(" | "),
    ]);
  }
  exportCsv(`glamour-vendas-${toDateInput(new Date())}.csv`, rows);
  setStatus("CSV de vendas exportado.", true);
}

function exportCashCsv() {
  const rows = [["data", "tipo", "descricao", "valor", "origem"]];
  for (const c of cash.slice().sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))) {
    rows.push([c.createdAt, c.type, c.desc, c.value, c.origin || ""]);
  }
  exportCsv(`glamour-caixa-${toDateInput(new Date())}.csv`, rows);
  setStatus("CSV do caixa exportado.", true);
}

function exportReportCsv() {
  const rows = [["periodo_de", "periodo_ate", "receita", "lucro", "vendas", "ticket_medio"]];
  rows.push([
    $("#repFrom").value || "",
    $("#repTo").value || "",
    $("#repRevenue").textContent,
    $("#repProfit").textContent,
    $("#repCount").textContent,
    $("#repAvg").textContent,
  ]);
  exportCsv(`glamour-relatorio-${toDateInput(new Date())}.csv`, rows);
  setStatus("Resumo exportado.", true);
}

// Utils
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function truncate(s, n) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// Tabs
function setTab(name) {
  $$(".navItem").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.remove("show"));
  $(`#tab-${name}`).classList.add("show");
  if (name === "dashboard") renderDashboard();
  if (name === "relatorios") renderReports();
}

async function refreshAll() {
  setStatus("Carregando…", true);

  products = await dbApi.getAll(dbApi.STORES.products);
  sales = await dbApi.getAll(dbApi.STORES.sales);
  cash = await dbApi.getAll(dbApi.STORES.cash);
  stockMoves = await dbApi.getAll(dbApi.STORES.stockMoves);

  $("#dbInfo").textContent = `Produtos: ${products.length} • Vendas: ${sales.length} • Caixa: ${cash.length}`;

  refreshDatalist();
  renderProducts();
  renderSalesTable();
  renderCashTable();
  renderDashboard();
  renderReports();

  setStatus("Pronto", true);
}

// Restock list generator
function createPurchaseListText() {
  const lows = products
    .filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0))
    .sort((a, b) => (Number(a.stock) - Number(b.stock)));

  if (!lows.length) return "Sem itens em alerta.";

  const lines = [];
  lines.push("GLAMOUR MAKEUP • LISTA DE REPOSIÇÃO");
  lines.push(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);
  lines.push("");
  for (const p of lows) {
    const need = Math.max(0, Number(p.minStock || 0) - Number(p.stock || 0));
    lines.push(`- ${p.name} (${p.category || "Sem categoria"}) • Estoque: ${p.stock} • Repor: +${need}${p.supplier ? " • Forn: " + p.supplier : ""}`);
  }
  return lines.join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Install prompt
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("#btnInstall").hidden = false;
});

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#btnInstall").hidden = true;
}

// SW
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // silencioso
  }
}

// Bindings
function bind() {
  // nav
  $$(".navItem").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // install
  $("#btnInstall").addEventListener("click", installApp);

  // product
  $("#btnNewProduct").addEventListener("click", () => openProductModal(null));
  $("#btnSaveProduct").addEventListener("click", saveProduct);
  $("#btnDeleteProduct").addEventListener("click", deleteProduct);
  $("#searchProduct").addEventListener("input", renderProducts);

  // low stock
  $("#searchLow").addEventListener("input", renderLowStock);
  $("#btnCreatePurchaseList").addEventListener("click", () => {
    const txt = createPurchaseListText();
    downloadText(`glamour-reposicao-${toDateInput(new Date())}.txt`, txt);
    setStatus("Lista de reposição gerada.", true);
  });

  // stock move
  $("#btnApplyStock").addEventListener("click", applyStockMove);

  // sale
  $("#btnAddItem").addEventListener("click", addItemToSale);
  $("#btnSaveSale").addEventListener("click", saveSale);
  $("#btnClearSale").addEventListener("click", clearSale);
  $("#btnQuickAddSale").addEventListener("click", () => setTab("vendas"));

  $("#saleCustomer").addEventListener("input", syncSaleFormToState);
  $("#salePayment").addEventListener("change", syncSaleFormToState);

  // export sales
  $("#btnExportSalesCsv").addEventListener("click", exportSalesCsv);
  $("#salesFrom").addEventListener("change", renderSalesTable);
  $("#salesTo").addEventListener("change", renderSalesTable);
  $("#salesSearch").addEventListener("input", renderSalesTable);

  // cash
  $("#btnAddCash").addEventListener("click", addCash);
  $("#btnExportCashCsv").addEventListener("click", exportCashCsv);
  $("#cashFrom").addEventListener("change", renderCashTable);
  $("#cashTo").addEventListener("change", renderCashTable);
  $("#cashSearch").addEventListener("input", renderCashTable);

  // reports
  $("#btnRunReports").addEventListener("click", renderReports);
  $("#btnExportReportCsv").addEventListener("click", exportReportCsv);

  // backup/restore
  $("#btnBackup").addEventListener("click", doBackup);
  $("#restoreFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await doRestore(f);
    } catch (err) {
      console.error(err);
      alert("Falha ao restaurar backup.");
      setStatus("Erro no restore.", false);
    } finally {
      e.target.value = "";
    }
  });
}

// Init defaults
function initDates() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  $("#salesFrom").value = toDateInput(from);
  $("#salesTo").value = toDateInput(today);

  $("#cashFrom").value = toDateInput(from);
  $("#cashTo").value = toDateInput(today);

  $("#repFrom").value = toDateInput(from);
  $("#repTo").value = toDateInput(today);
}

(async function main() {
  bind();
  initDates();
  await registerSW();

  try {
    await refreshAll();
    setTab("dashboard");
  } catch (err) {
    console.error(err);
    setStatus("Erro ao abrir base local.", false);
    alert("Erro ao iniciar. Tenta recarregar a página.");
  }
})();
