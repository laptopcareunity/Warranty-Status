/* =========================================================================
   LaptopCare Staff Admin — behaviour
   Depends on: assets/config.js (window.LC_CONFIG) and Supabase JS v2.
   -------------------------------------------------------------------------
   Keeps both tables in memory after load, then filters/paginates/exports
   locally. Every Save/Add/Delete goes straight to Supabase and the local
   copy is refreshed, so the stat cards always stay in sync.
   ========================================================================= */
(function () {
  "use strict";

  var CFG = window.LC_CONFIG || {};
  var TABLES = CFG.tables || { warranty: "warranty_status", service: "service_status" };
  var W_STAGES = CFG.warrantyStages || [];
  var S_STAGES = CFG.serviceStages || [];
  var HOLD = CFG.holdStatus || "On Hold";
  var W_OPEN = ["Received", "Diagnosis", "Parts Ordered", "In Repair"];
  var S_ACTIVE = ["Scheduled", "Service in Progress"];

  var sb = null;
  if (window.supabase && CFG.supabase && CFG.supabase.url) {
    sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.anonKey);
  }

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function stampTime(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function dateInputVal(v) {
    return v ? String(v).slice(0, 10) : "";
  }
  function toast(text, type) {
    var wrap = $("toasts");
    if (!wrap) return;
    var icons = { ok: "\u2713", err: "\u26A0", warn: "\u26A0" };
    var el = document.createElement("div");
    el.className = "toast " + (type === "error" ? "err" : type === "warn" ? "warn" : "ok");
    var ic = document.createElement("span");
    ic.className = "t-ico";
    ic.textContent = icons[type || "ok"] || "\u2713";
    var tx = document.createElement("span");
    tx.textContent = text;
    el.appendChild(ic);
    el.appendChild(tx);
    wrap.appendChild(el);
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
    setTimeout(function () {
      el.style.opacity = "0";
      el.style.transition = "opacity .3s";
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 3400);
  }
  function showMsg(id, type, text) {
    var box = $(id);
    if (!box) return;
    box.className = "msg show msg-" + (type === "error" ? "error" : type === "warn" ? "warn" : "info");
    box.textContent = text || "";
  }
  function hideMsg(id) {
    var box = $(id);
    if (box) box.className = "msg";
  }
  /* ---------------- option builders ----------------
     Row selects only ever offer real stage values; the toolbar filter
     select additionally offers grouped tokens ("open", "ready", ...). */
  function plainOptions(list, selected) {
    var out = '<option value="">\u2014 not set \u2014</option>';
    list.forEach(function (s) {
      out += '<option value="' + esc(s) + '"' + (s === selected ? " selected" : "") + ">" + esc(s) + "</option>";
    });
    return out;
  }
  function rowStatusOptions(kind, selected) {
    var stages = kind === "w" ? W_STAGES : S_STAGES;
    var list = stages.indexOf(HOLD) === -1 ? stages.concat([HOLD]) : stages;
    return plainOptions(list, selected || "");
  }
  function filterOptions(kind) {
    var groups = kind === "w"
      ? [["open", "\u25B8 Open (Received \u2192 In Repair)"], ["ready", "\u25B8 Ready for Pickup"], ["hold", "\u25B8 On Hold"], ["done", "\u25B8 Completed"]]
      : [["new", "\u25B8 New (Processing)"], ["active", "\u25B8 Active (Scheduled \u2192 In Progress)"], ["hold", "\u25B8 On Hold"], ["done", "\u25B8 Completed"]];
    var html = "";
    groups.forEach(function (g) {
      html += '<option value="' + g[0] + '">' + g[1] + "</option>";
    });
    var indiv = kind === "w" ? W_STAGES.concat([HOLD]) : S_STAGES.concat([HOLD]);
    indiv.forEach(function (s) {
      html += '<option value="' + esc(s) + '">' + esc(s) + "</option>";
    });
    return html;
  }
  function rowShadowClass(status) {
    var s = String(status || "").trim();
    var map = {
      "Received": "s-rec", "Processing": "s-rec",
      "Diagnosis": "s-dia", "Scheduled": "s-dia",
      "Parts Ordered": "s-par",
      "In Repair": "s-rep", "Service in Progress": "s-rep",
      "Ready for Pickup": "s-rdy",
      "Completed": "s-cmp", "Complete": "s-cmp",
      "On Hold": "s-hold"
    };
    return map[s] || "";
  }

  /* ---------------- data + state ---------------- */
  var DB = { w: [], s: [] };
  var filter = {
    w: { q: "", st: "" },
    s: { q: "", st: "" }
  };
  var page = { w: 1, s: 1 };
  var PER_PAGE = { w: "25", s: "25" };
  var editing = false;
  var user = null;

  var KINDS = {
    w: { table: TABLES.warranty, label: "warranty", title: "Warranty records", serialCap: "warranty" },
    s: { table: TABLES.service, label: "service", title: "Service records", serialCap: "service" }
  };

  function serialOf(row) { return String(row.serial_number || "").trim(); }
  function searchable(kind, row) {
    var fields = kind === "w"
      ? [row.serial_number, row.customer_name, row.notes]
      : [row.serial_number, row.customer_name, row.phone_number, row.laptop_model, row.invoice_number];
    return fields.join(" ").toLowerCase();
  }
  function matches(kind, row) {
    var f = filter[kind];
    if (f.st) {
      if (f.st === "hold") { if (String(row.status || "").trim() !== HOLD) return false; }
      else if (f.st === "open") { if (W_OPEN.indexOf(String(row.status || "").trim()) === -1) return false; }
      else if (f.st === "active") { if (S_ACTIVE.indexOf(String(row.status || "").trim()) === -1) return false; }
      else if (f.st === "done") { if (!(row.status === "Completed" || row.status === "Complete")) return false; }
      else if (f.st === "ready") { if (row.status !== "Ready for Pickup") return false; }
      else if (f.st === "new") { if (row.status !== "Processing") return false; }
      else if (row.status !== f.st) return false;
    }
    if (f.q) {
      var q = f.q.toLowerCase();
      if (searchable(kind, row).indexOf(q) === -1) return false;
    }
    return true;
  }
  function filtered(kind) { return DB[kind].filter(function (r) { return matches(kind, r); }); }

  /* ---------------- stats ---------------- */
  function computeStats() {
    var w = DB.w, s = DB.s;
    function cnt(list, fn) { return list.filter(fn).length; }
    return {
      wOpen: cnt(w, function (r) { return W_OPEN.indexOf(String(r.status || "").trim()) !== -1; }),
      wReady: cnt(w, function (r) { return r.status === "Ready for Pickup"; }),
      wHold: cnt(w, function (r) { return r.status === HOLD; }),
      wDone: cnt(w, function (r) { return r.status === "Completed"; }),
      sNew: cnt(s, function (r) { return r.status === "Processing"; }),
      sActive: cnt(s, function (r) { return S_ACTIVE.indexOf(String(r.status || "").trim()) !== -1; }),
      sHold: cnt(s, function (r) { return r.status === HOLD; }),
      sDone: cnt(s, function (r) { return r.status === "Complete"; })
    };
  }
  var STAT_DEFS = [
    { k: "wOpen", lbl: "Open repairs", tone: "c-amber", bg: "b-amber", tab: "w", st: "open", ico: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4.5 4.5 0 0 0-6.1 5.6L3 17.5V21h3.5l5.6-5.6a4.5 4.5 0 0 0 5.6-6.1l-2.9 2.9-2.8-.7-.7-2.8 2.9-2.9z"/></svg>' },
    { k: "wReady", lbl: "Ready for pickup", tone: "c-cyan", bg: "b-cyan", tab: "w", st: "ready", ico: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>' },
    { k: "wHold", lbl: "On hold \u2014 warranty", tone: "c-red", bg: "b-red", tab: "w", st: "hold", ico: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M10 9.5v5M14 9.5v5"/></svg>' },
    { k: "wDone", lbl: "Completed repairs", tone: "c-green", bg: "b-green", tab: "w", st: "done", ico: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/></svg>' },
    { k: "sNew", lbl: "New bookings", tone: "c-blue", bg: "b-blue", tab: "s", st: "new", ico: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>' },
    { k: "sActive", lbl: "Active services", tone: "c-violet", bg: "b-violet", tab: "s", st: "active", ico: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 8-6-16-3 8H2"/></svg>' },
    { k: "sHold", lbl: "On hold \u2014 service", tone: "c-red", bg: "b-red", tab: "s", st: "hold", ico: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M10 9.5v5M14 9.5v5"/></svg>' },
    { k: "sDone", lbl: "Completed services", tone: "c-green", bg: "b-green", tab: "s", st: "done", ico: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' }
  ];
  function renderStats() {
    var nums = computeStats();
    var box = $("stats");
    box.textContent = "";
    STAT_DEFS.forEach(function (d) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stat";
      btn.setAttribute("data-tab", d.tab);
      btn.setAttribute("data-st", d.st);
      var ico = document.createElement("span");
      ico.className = "s-ico " + d.bg + " " + d.tone;
      ico.innerHTML = d.ico;
      var info = document.createElement("span");
      info.style.minWidth = "0";
      var num = document.createElement("span");
      num.className = "s-num " + d.tone;
      num.textContent = nums[d.k];
      var lbl = document.createElement("span");
      lbl.className = "s-lbl";
      lbl.textContent = d.lbl;
      lbl.style.display = "block";
      info.appendChild(num);
      info.appendChild(lbl);
      btn.appendChild(ico);
      btn.appendChild(info);
      btn.addEventListener("click", function () {
        showSection(d.tab === "w" ? "secWarranty" : "secService");
        var sel = $(d.tab === "w" ? "wFilter" : "sFilter");
        if (sel) sel.value = d.st;
        filter[d.tab].st = d.st;
        page[d.tab] = 1;
        render(d.tab);
      });
      box.appendChild(btn);
    });
    $("wCount").textContent = filtered("w").length + " shown";
    $("sCount").textContent = filtered("s").length + " shown";
  }

  /* ---------------- auth ---------------- */
  function renderLogin(msgText) {
    $("loginCard").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
    if (msgText) showMsg("loginError", "error", msgText);
    $("loginEmail").focus();
  }
  function enterDashboard(u) {
    user = u;
    $("loginCard").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("staffEmail").textContent = "Signed in \u2014 " + (u.email || "");
    loadAll(true);
  }
  function bindAuth() {
    if (!sb) { renderLogin("Admin database isn't configured \u2014 please contact your developer."); return; }
    $("loginForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      hideMsg("loginError");
      var btn = $("loginBtn");
      btn.disabled = true;
      btn.textContent = "Signing in\u2026";
      var res = await sb.auth.signInWithPassword({
        email: $("loginEmail").value.trim(),
        password: $("loginPassword").value
      });
      btn.disabled = false;
      btn.textContent = "Sign in";
      if (res.error) {
        renderLogin(res.error.message === "Invalid login credentials"
          ? "Incorrect email or password. Please try again."
          : "Sign-in failed: " + res.error.message);
        return;
      }
      enterDashboard(res.data.user);
    });
    $("logoutBtn").addEventListener("click", async function () {
      await sb.auth.signOut();
    });
    sb.auth.onAuthStateChange(function (ev, session) {
      if (ev === "SIGNED_OUT") {
        $("loginPassword").value = "";
        user = null;
        renderLogin();
      }
    });
    $("pwToggle").addEventListener("click", function () {
      var pw = $("loginPassword");
      var show = pw.type === "password";
      pw.type = show ? "text" : "password";
      this.textContent = show ? "Hide" : "Show";
    });
    sb.auth.getSession().then(function (r) {
      if (r.data.session) enterDashboard(r.data.session.user);
      else renderLogin();
    });
  }

  /* ---------------- data loading ---------------- */
  async function loadAll(quiet) {
    if (!sb) return;
    try {
      var paths = [
        sb.from(KINDS.w.table).select("*").order("id", { ascending: false }),
        sb.from(KINDS.s.table).select("*").order("id", { ascending: false })
      ];
      var results = await Promise.all(paths);
      var we = results[0].error, se = results[1].error;
      if (we || se) {
        var msg = (we && we.message) || (se && se.message) || "unknown error";
        toast("Could not load records: " + msg, "error");
        return;
      }
      DB.w = results[0].data || [];
      DB.s = results[1].data || [];
      page.w = 1; page.s = 1;
      renderStats();
      render("w");
      render("s");
      $("stamp").textContent = "Updated " + stampTime(new Date());
      if (!quiet) toast("Records refreshed (" + DB.w.length + " warranty, " + DB.s.length + " service)", "ok");
    } catch (err) {
      console.error(err);
      toast("Connection problem while loading records.", "error");
    }
  }
  $("refreshBtn").addEventListener("click", function () { loadAll(false); });
  setInterval(function () {
    if (document.visibilityState === "visible" && !editing) loadAll(true);
  }, 60000);

  /* ---------------- rendering ---------------- */
  function selectFilter(kind, el) {
    el.innerHTML = '<option value="">All statuses</option>' + filterOptions(kind);
  }
  function paginate(kind) {
    var list = filtered(kind);
    var per = PER_PAGE[kind];
    var perN = per === "all" ? Infinity : parseInt(per, 10) || 25;
    var pages = Math.max(1, Math.ceil(list.length / perN));
    if (page[kind] > pages) page[kind] = pages;
    var start = (page[kind] - 1) * perN;
    return { rows: list.slice(start, start + perN), pages: pages, total: list.length };
  }
  
  function render(kind) {
    var rows = paginate(kind).rows;
    var tbody = kind === "w" ? $("warrantyTbody") : $("serviceTbody");
    var isW = kind === "w";

    if (!rows.length) {
      var colspan = isW ? 7 : 11;
      tbody.innerHTML = '<tr><td colspan="' + colspan + '"><div class="empty-state"><b>' +
        (filter[kind].q || filter[kind].st ? "No records match your filters" : "No records yet") +
        "</b>" + (filter[kind].q || filter[kind].st ? "Try clearing the search box or status filter." : "Add the first record with the button above.") + "</div></td></tr>";
    } else {
      var html = "";
      rows.forEach(function (r) {
        var serial = esc(serialOf(r));
        var sh = rowShadowClass(r.status);
        html += '<tr class="' + sh + '" data-id="' + esc(r.id) + '">';
        html += '<td class="serial">' + serial + '<span class="sub">record #' + esc(r.id) + "</span></td>";
        if (isW) {
          html += '<td><input class="in" data-f="customer_name" value="' + esc(r.customer_name || "") + '" placeholder="Customer name"></td>';
          html += '<td><select class="in" data-f="status">' + rowStatusOptions("w", r.status) + "</select></td>";
          html += '<td><input class="in" type="date" data-f="handover_date" value="' + esc(dateInputVal(r.handover_date)) + '"></td>';
          html += '<td><input class="in" type="date" data-f="estimated_completion" value="' + esc(dateInputVal(r.estimated_completion)) + '"></td>';
          html += '<td><input class="in" data-f="notes" value="' + esc(r.notes || "") + '" placeholder="Note for customer"></td>';
        } else {
          html += '<td><input class="in" data-f="customer_name" value="' + esc(r.customer_name || "") + '" placeholder="Customer"></td>';
          html += '<td><input class="in" data-f="phone_number" value="' + esc(r.phone_number || "") + '" placeholder="Phone"></td>';
          html += '<td><input class="in" data-f="laptop_model" value="' + esc(r.laptop_model || "") + '" placeholder="Model"></td>';
          html += '<td><input class="in" type="date" data-f="purchase_date" value="' + esc(dateInputVal(r.purchase_date)) + '"></td>';
          html += '<td><input class="in" data-f="invoice_number" value="' + esc(r.invoice_number || "") + '" placeholder="Invoice"></td>';
          html += '<td><select class="in" data-f="status">' + rowStatusOptions("s", r.status) + "</select></td>";
          html += '<td><input class="in" type="date" data-f="scheduled_date" value="' + esc(dateInputVal(r.scheduled_date)) + '"></td>';
          html += '<td><input class="in" type="date" data-f="service_end_date" value="' + esc(dateInputVal(r.service_end_date)) + '"></td>';
          html += '<td><input class="in" data-f="notes" value="' + esc(r.notes || "") + '" placeholder="Note for customer"></td>';
        }
        html += '<td><div class="row-actions">' +
          '<button class="btn btn-sm save-row" data-id="' + esc(r.id) + '">Save</button>' +
          '<button class="trash-btn del-row" data-id="' + esc(r.id) + '" title="Delete record" aria-label="Delete record">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>' +
          "</button></div></td>";
        html += "</tr>";
      });
      tbody.innerHTML = html;
    }
    /* pager */
    var p = paginate(kind);
    var infoEl = kind === "w" ? $("wPageInfo") : $("sPageInfo");
    var prevBtn = kind === "w" ? $("wPrev") : $("sPrev");
    var nextBtn = kind === "w" ? $("wNext") : $("sNext");
    if (PER_PAGE[kind] === "all") {
      infoEl.textContent = p.total + " of " + p.total + " shown";
    } else {
      var perN = parseInt(PER_PAGE[kind], 10) || 25;
      var first = p.total ? (page[kind] - 1) * perN + 1 : 0;
      var last = Math.min(page[kind] * perN, p.total);
      infoEl.textContent = first + "\u2013" + last + " of " + p.total;
    }
    prevBtn.disabled = page[kind] <= 1;
    nextBtn.disabled = page[kind] >= p.pages;
    renderStats();
  }

  /* ---------------- row actions (delegated) ---------------- */
  function bindRows(kind, tbodyId) {
    $(tbodyId).addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      var id = t.getAttribute("data-id");
      var tr = t.closest("tr");
      var table = KINDS[kind].table;
      if (t.classList.contains("save-row")) {
        saveRow(kind, id, tr, table);
      } else if (t.classList.contains("del-row")) {
        deleteRow(kind, id, tr, table);
      }
    });
  }
  async function saveRow(kind, id, tr, table) {
    var payload = { last_updated: new Date().toISOString() };
    tr.querySelectorAll("[data-f]").forEach(function (el) {
      payload[el.getAttribute("data-f")] = el.value || null;
    });
    if (payload.status === "Complete" && !payload.service_end_date) {
      payload.service_end_date = todayISO();
    }
    var saveBtn = tr.querySelector(".save-row");
    saveBtn.disabled = true;
    var res = await sb.from(table).update(payload).eq("id", id);
    saveBtn.disabled = false;
    if (res.error) {
      console.error(res.error);
      toast("Save failed for record #" + id + ": " + res.error.message, "error");
      return;
    }
    /* keep local copy in sync */
    var list = DB[kind];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) {
        list[i] = Object.assign({}, list[i], payload);
        break;
      }
    }
    render(kind);
    var saved = DB[kind].find(function (x) { return String(x.id) === String(id); });
    toast("Saved \u2014 " + (saved ? serialOf(saved) : "record #" + id), "ok");
  }
  async function deleteRow(kind, id, tr, table) {
    var serial = serialOf(DB[kind].find(function (x) { return String(x.id) === String(id); }));
    var sure = window.confirm(
      "Delete this " + KINDS[kind].label + " record" + (serial ? " for " + serial : "") + "?\n\n" +
      "This removes it for customers too and cannot be undone."
    );
    if (!sure) return;
    tr.querySelector(".del-row").disabled = true;
    var res = await sb.from(table).delete().eq("id", id);
    if (res.error) {
      console.error(res.error);
      toast("Delete failed: " + res.error.message, "error");
      tr.querySelector(".del-row").disabled = false;
      return;
    }
    DB[kind] = DB[kind].filter(function (x) { return String(x.id) !== String(id); });
    render(kind);
    toast("Record deleted" + (serial ? " \u2014 " + serial : ""), "ok");
  }

  /* ---------------- toolbar wiring ---------------- */
  ["w", "s"].forEach(function (kind) {
    var deb;
    $(kind === "w" ? "wSearch" : "sSearch").addEventListener("input", function (e) {
      clearTimeout(deb);
      var v = e.target.value;
      deb = setTimeout(function () {
        filter[kind].q = v.trim();
        page[kind] = 1;
        render(kind);
      }, 180);
    });
    $(kind === "w" ? "wFilter" : "sFilter").addEventListener("change", function (e) {
      filter[kind].st = e.target.value;
      page[kind] = 1;
      render(kind);
    });
    $(kind === "w" ? "wPerPage" : "sPerPage").addEventListener("change", function (e) {
      PER_PAGE[kind] = e.target.value;
      page[kind] = 1;
      render(kind);
    });
    $(kind === "w" ? "wPrev" : "sPrev").addEventListener("click", function () {
      if (page[kind] > 1) { page[kind]--; render(kind); }
    });
    $(kind === "w" ? "wNext" : "sNext").addEventListener("click", function () {
      var p = paginate(kind);
      if (page[kind] < p.pages) { page[kind]++; render(kind); }
    });
    $(kind === "w" ? "wExportBtn" : "sExportBtn").addEventListener("click", function () {
      exportCsv(kind);
    });
  });

  function exportCsv(kind) {
    var cols = kind === "w"
      ? ["id", "serial_number", "customer_name", "status", "handover_date", "estimated_completion", "notes", "last_updated", "created_at"]
      : ["id", "serial_number", "customer_name", "phone_number", "laptop_model", "purchase_date", "invoice_number", "status", "scheduled_date", "service_end_date", "notes", "last_updated", "created_at"];
    var list = filtered(kind);
    if (!list.length) { toast("Nothing to export \u2014 no rows match.", "warn"); return; }
    function csvCell(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
    var lines = [cols.map(csvCell).join(",")];
    list.forEach(function (r) {
      lines.push(cols.map(function (c) { return csvCell(r[c]); }).join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    var d = todayISO();
    a.href = URL.createObjectURL(blob);
    a.download = (kind === "w" ? "warranty-records-" : "service-records-") + d + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 300);
    toast("Exported " + list.length + " row" + (list.length === 1 ? "" : "s") + " to CSV", "ok");
  }

  /* ---------------- section tabs ---------------- */
  function showSection(id) {
    document.querySelectorAll(".section-tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-section") === id);
    });
    document.querySelectorAll(".section-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === id);
    });
  }
  document.querySelectorAll(".section-tab").forEach(function (b) {
    b.addEventListener("click", function () { showSection(b.getAttribute("data-section")); });
  });

  /* ---------------- add records ---------------- */
  function toggleAdd(kind, forceShow) {
    var card = kind === "w" ? $("wAddCard") : $("sAddCard");
    var btn = kind === "w" ? $("wAddToggle") : $("sAddToggle");
    var willShow = forceShow === undefined ? card.classList.contains("hidden") : forceShow;
    card.classList.toggle("hidden", !willShow);
    btn.classList.toggle("btn-primary", willShow);
    btn.textContent = willShow ? "\u2715 Close form" : "\u002B Add " + (kind === "w" ? "warranty record" : "service record");
    if (willShow) (kind === "w" ? $("waSerial") : $("saSerial")).focus();
  }
  $("wAddToggle").addEventListener("click", function () { toggleAdd("w"); });
  $("sAddToggle").addEventListener("click", function () { toggleAdd("s"); });
  $("waCancel").addEventListener("click", function () { toggleAdd("w", false); });
  $("saCancel").addEventListener("click", function () { toggleAdd("s", false); });

  function readAddForm(kind) {
    var p = function (id) { return $(id).value.trim(); };
    if (kind === "w") {
      return {
        serial_number: p("waSerial").toUpperCase(),
        customer_name: p("waCustomer"),
        handover_date: $("waHandover").value || null,
        estimated_completion: $("waEst").value || null,
        notes: p("waNotes"),
        status: "Received"
      };
    }
    return {
      serial_number: p("saSerial").toUpperCase(),
      customer_name: p("saCustomer"),
      phone_number: p("saPhone"),
      laptop_model: p("saLaptop"),
      purchase_date: $("saPurchase").value || null,
      invoice_number: p("saInvoice"),
      notes: p("saNotes"),
      status: "Processing"
    };
  }
  async function addRecord(kind) {
    var msgId = kind === "w" ? "waMsg" : "saMsg";
    hideMsg(msgId);
    var payload = readAddForm(kind);
    var table = KINDS[kind].table;
    var cap = KINDS[kind].serialCap;
    if (!payload.serial_number) {
      showMsg(msgId, "error", "Serial number is required.");
      return;
    }
    var dup = await sb.from(table).select("id,status,customer_name")
      .ilike("serial_number", payload.serial_number)
      .order("id", { ascending: false }).limit(1);
    if (dup.error) {
      showMsg(msgId, "error", "Couldn't check for duplicates: " + dup.error.message);
      return;
    }
    var existing = dup.data && dup.data[0];
    if (existing) {
      if (kind === "w") {
        showMsg(msgId, "error",
          "A " + cap + " record for " + payload.serial_number + " already exists (record #" + existing.id +
          (existing.status ? ", currently: " + existing.status : "") + "). Edit that row instead.");
        return;
      }
      if (!window.confirm(
        "A service record already exists for " + payload.serial_number +
        " (record #" + existing.id + (existing.status ? ", " + existing.status : "") + ").\n\n" +
        "Customers always see the most recent record. Add another anyway?"
      )) return;
    }
    payload.last_updated = new Date().toISOString();
    var res = await sb.from(table).insert([payload]);
    if (res.error) {
      showMsg(msgId, "error", "Couldn't add record: " + res.error.message);
      return;
    }
    toast("Added " + cap + " record \u2014 " + payload.serial_number, "ok");
    toggleAdd(kind, false);
    filter[kind].q = "";
    filter[kind].st = "";
    $(kind === "w" ? "wSearch" : "sSearch").value = "";
    $(kind === "w" ? "wFilter" : "sFilter").value = "";
    await loadAll(true);
  }
  $("waSave").addEventListener("click", function () { addRecord("w"); });
  $("saSave").addEventListener("click", function () { addRecord("s"); });
  /* Enter inside add forms triggers save (inputs live outside <form>) */
  ["wAddCard", "sAddCard"].forEach(function (cardId) {
    $(cardId).addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") {
        e.preventDefault();
        addRecord(cardId === "wAddCard" ? "w" : "s");
      }
    });
  });

  /* ---------------- pause auto-refresh while editing ---------------- */
  document.addEventListener("focusin", function (e) {
    if (e.target.closest(".table-card") && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) {
      editing = true;
    }
  });
  document.addEventListener("focusout", function (e) {
    if (e.target.closest(".table-card")) editing = false;
  });

  /* ---------------- init ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    selectFilter("w", $("wFilter"));
    selectFilter("s", $("sFilter"));
    bindRows("w", "warrantyTbody");
    bindRows("s", "serviceTbody");
    bindAuth();
  });
})();
