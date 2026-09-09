/* =========================================================================
   LaptopCare Customer Portal — behaviour
   Depends on: assets/config.js (window.LC_CONFIG) and Supabase JS v2
   (loaded from CDN in index.html before this file).
   ========================================================================= */
(function () {
  "use strict";

  var CFG = window.LC_CONFIG || {};
  var COMPANY = CFG.company || {};
  var TABLES = CFG.tables || { warranty: "warranty_status", service: "service_status" };
  var W_STAGES = CFG.warrantyStages || [];
  var S_STAGES = CFG.serviceStages || [];
  var HOLD = CFG.holdStatus || "On Hold";

  /* ------------------------------------------------------------------ */
  /* Supabase client                                                    */
  /* ------------------------------------------------------------------ */
  var sb = null;
  if (window.supabase && CFG.supabase && CFG.supabase.url) {
    sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.anonKey);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      showMsg("warrantyMsg", "error", "The portal is not configured yet. Please contact LaptopCare.");
    });
  }

  var OPEN_SERVICE_STATUSES = ["Processing", "Scheduled", "Service in Progress", "On Hold"];

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                      */
  /* ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function normSerial(s) {
    return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
  }
  function fmtDate(v) {
    if (!v) return "—";
    var s = String(v);
    return s.slice(0, 10); /* keep YYYY-MM-DD even if a timestamp arrives */
  }
  function relAgo(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return "updated today";
    if (days === 1) return "updated yesterday";
    if (days < 30) return "updated " + days + " days ago";
    return "last updated " + fmtDate(v);
  }
  function toneFor(status) {
    var s = String(status || "").trim();
    if (s === HOLD) return "red";
    if (s === "Ready for Pickup") return "cyan";
    if (s === "Completed" || s === "Complete") return "green";
    if (s === "In Repair" || s === "Service in Progress") return "amber";
    if (s === "Diagnosis" || s === "Scheduled") return "blue";
    if (s === "Parts Ordered") return "violet";
    return "slate"; /* Received / Processing / unknown */
  }

  function showMsg(id, type, text) {
    var box = $(id);
    if (!box) return;
    var style = type === "error" ? "error" : type === "warn" ? "warn" : "info"; /* loading uses info */
    box.className = "msg show msg-" + style;
    box.textContent = "";
    var lead = document.createElement("span");
    if (type === "loading") {
      lead.className = "spinner";
    } else {
      lead.textContent = type === "error" || type === "warn" ? "\u26A0 " : "\u2139 ";
    }
    var span = document.createElement("span");
    span.textContent = text;
    box.appendChild(lead);
    box.appendChild(span);
  }
  function hideMsg(id) {
    var box = $(id);
    if (box) box.className = "msg";
  }
  function setFieldError(input, message) {
    var key = input.getAttribute("data-err");
    if (!key) return;
    var el = $(key);
    if (el) {
      el.textContent = message;
      el.classList.toggle("show", !!message);
    }
    input.classList.toggle("invalid", !!message);
  }
  function clearFieldErrors(form) {
    form.querySelectorAll("[data-err]").forEach(function (i) {
      setFieldError(i, "");
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                               */
  /* ------------------------------------------------------------------ */
  function switchTab(name, opts) {
    opts = opts || {};
    document.querySelectorAll(".seg-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === name);
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "panel-" + name);
    });
    if (name === "warranty" && opts.focus !== false) {
      var wIn = $("warrantyLookup");
      if (wIn && !wIn.value) wIn.focus();
    } else if (name === "service" && opts.focus !== false) {
      var sIn = $("serviceLookup");
      if (sIn && !sIn.value) sIn.focus();
    } else if (name === "book") {
      var nIn = $("bkName");
      if (nIn && !nIn.value) nIn.focus();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.querySelectorAll(".seg-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchTab(btn.getAttribute("data-tab"));
    });
  });

  /* ------------------------------------------------------------------ */
  /* Recent lookups (localStorage, per device)                          */
  /* ------------------------------------------------------------------ */
  var recentsKey = CFG.recentsKey || "laptopcare.recent";
  function getRecents() {
    try {
      var raw = JSON.parse(localStorage.getItem(recentsKey) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }
  function remember(kind, serial) {
    var list = getRecents().filter(function (r) {
      return !(r.k === kind && r.s === serial);
    });
    list.unshift({ k: kind, s: serial, t: Date.now() });
    try { localStorage.setItem(recentsKey, JSON.stringify(list.slice(0, 5))); }
    catch (e) { /* private mode: ignore */ }
  }
  function renderRecents(kind) {
    var box = $(kind === "w" ? "warrantyRecent" : "serviceRecent");
    if (!box) return;
    box.textContent = "";
    var list = getRecents().filter(function (r) { return r.k === kind; });
    if (!list.length) { box.classList.remove("show"); return; }
    box.classList.add("show");
    var label = document.createElement("span");
    label.className = "recent-label";
    label.textContent = "Recent";
    box.appendChild(label);
    list.forEach(function (r) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.title = "Check " + r.s + " again";
      var dot = document.createElement("span");
      dot.className = "dot" + (kind === "s" ? " svc" : "");
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(r.s));
      chip.addEventListener("click", function () {
        if (kind === "w") {
          $("warrantyLookup").value = r.s;
          checkWarranty();
        } else {
          $("serviceLookup").value = r.s;
          checkService();
        }
      });
      box.appendChild(chip);
    });
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "chip-x";
    clear.title = "Clear recent lookups";
    clear.setAttribute("aria-label", "Clear recent lookups");
    clear.textContent = "\u2715";
    clear.addEventListener("click", function () {
      try {
        localStorage.setItem(recentsKey, JSON.stringify(getRecents().filter(function (x) { return x.k !== kind; })));
      } catch (e) { /* ignore */ }
      renderRecents(kind);
    });
    box.appendChild(clear);
  }

  /* ------------------------------------------------------------------ */
  /* Shared result renderer                                             */
  /* ------------------------------------------------------------------ */
  function buildTimeline(trackEl, stages, idx, hold) {
    trackEl.textContent = "";
    if (!stages.length) return;
    stages.forEach(function (stage, i) {
      var step = document.createElement("div");
      step.className = "tstep";
      if (hold && i === idx) step.classList.add("hold");
      else if (i < idx) step.classList.add("done");
      else if (i === idx) step.classList.add("curr");
      var dot = document.createElement("div");
      dot.className = "tdot";
      dot.textContent = hold && i === idx ? "\u23F8" : String(i + 1);
      var lab = document.createElement("div");
      lab.className = "tlabel";
      lab.textContent = stage;
      step.appendChild(dot);
      step.appendChild(lab);
      trackEl.appendChild(step);
    });
  }

  /* ================================================================== */
  /* WARRANTY STATUS                                                    */
  /* ================================================================== */
  async function checkWarranty() {
    var raw = normSerial($("warrantyLookup").value);
    var btn = $("warrantyCheckBtn");
    var result = $("warrantyResult");
    hideMsg("warrantyMsg");
    result.classList.add("hidden");
    if (!raw) {
      showMsg("warrantyMsg", "error", "Please enter a serial number first — it is printed on your purchase invoice.");
      $("warrantyLookup").focus();
      return;
    }
    btn.disabled = true;
    showMsg("warrantyMsg", "loading", "Looking up warranty record " + raw + "\u2026");
    try {
      var q = sb.from(TABLES.warranty).select("*").ilike("serial_number", raw);
      var latest = await q.order("id", { ascending: false }).limit(1);
      if (latest.error) throw latest.error;
      var m = latest.data && latest.data[0];
      if (!m) {
        showMsg("warrantyMsg", "error",
          "We couldn\u2019t find a warranty record for \u201C" + raw + "\u201D. Please double-check the serial on your invoice, or contact us for help.");
        return;
      }
      remember("w", raw);
      renderRecents("w");
      var status = String(m.status || "").trim() || "Unknown";
      var hold = status === HOLD;
      var idx = W_STAGES.indexOf(status);
      var tone = toneFor(status);

      var banner = $("wStatusBanner");
      banner.className = "status-banner tone-" + tone;
      $("wStatusBig").textContent = status;
      $("wStatusPill").textContent = idx === -1 && !hold ? "See note" : status;
      $("wBannerUpdated").textContent = relAgo(m.last_updated);

      $("wSerialVal").textContent = normSerial(m.serial_number);
      $("wCustomerVal").textContent = m.customer_name || "—";
      $("wHandoverVal").textContent = fmtDate(m.handover_date);
      $("wEstVal").textContent = fmtDate(m.estimated_completion);
      $("wHoldNote").classList.toggle("show", hold);
      buildTimeline($("wTrack"), W_STAGES, idx >= 0 ? idx : 0, hold);

      var note = $("wNote");
      var hasNote = m.notes && String(m.notes).trim();
      note.classList.toggle("hidden", !hasNote);
      $("wNoteValue").textContent = hasNote ? m.notes : "";

      /* contextual actions */
      var bookBtn = $("wBookBtn");
      bookBtn.classList.toggle("hidden", status === "Completed" || status === "On Hold" || idx === -1);
      bookBtn.setAttribute("data-serial", normSerial(m.serial_number));
      var askLink = $("wAskLink");
      askLink.href = "mailto:" + COMPANY.email +
        "?subject=" + encodeURIComponent("Question about warranty " + normSerial(m.serial_number));

      result.classList.remove("hidden");
      $("wStatusBig").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      console.error(err);
      showMsg("warrantyMsg", "error",
        "We couldn\u2019t reach the warranty database. Please check your connection and try again in a moment.");
    } finally {
      btn.disabled = false;
    }
  }

  /* ================================================================== */
  /* SERVICE STATUS                                                     */
  /* ================================================================== */
  function stageIndexForService(m) {
    var status = String(m.status || "").trim();
    var idx = S_STAGES.indexOf(status);
    if (idx !== -1) return idx;
    if (m.scheduled_date) return 1;
    return 0;
  }
  async function checkService() {
    var raw = normSerial($("serviceLookup").value);
    var btn = $("serviceCheckBtn");
    var result = $("serviceResult");
    hideMsg("serviceMsg");
    result.classList.add("hidden");
    if (!raw) {
      showMsg("serviceMsg", "error", "Please enter the serial number you used when booking.");
      $("serviceLookup").focus();
      return;
    }
    btn.disabled = true;
    showMsg("serviceMsg", "loading", "Looking up service booking " + raw + "\u2026");
    try {
      var q = sb.from(TABLES.service).select("*").ilike("serial_number", raw);
      var latest = await q.order("id", { ascending: false }).limit(1);
      if (latest.error) throw latest.error;
      var m = latest.data && latest.data[0];
      if (!m) {
        showMsg("serviceMsg", "error",
          "We couldn\u2019t find a service booking for \u201C" + raw + "\u201D yet. New bookings appear here once our team reviews them \u2014 or try the \u201CBook a Service\u201D tab to get started.");
        return;
      }
      remember("s", raw);
      renderRecents("s");
      var status = String(m.status || "").trim();
      var displayStatus = status || S_STAGES[stageIndexForService(m)];
      var hold = status === HOLD;
      var idx = stageIndexForService(m);
      var tone = toneFor(status || displayStatus);

      var banner = $("sStatusBanner");
      banner.className = "status-banner tone-" + tone;
      $("sStatusBig").textContent = displayStatus;
      $("sStatusPill").textContent = status || "Pending review";
      $("sBannerUpdated").textContent = relAgo(m.last_updated);

      $("sSerialVal").textContent = normSerial(m.serial_number);
      $("sCustomerVal").textContent = m.customer_name || "—";
      $("sScheduledVal").textContent = fmtDate(m.scheduled_date);
      $("sEndVal").textContent = fmtDate(m.service_end_date);
      $("sHoldNote").classList.toggle("show", hold);
      buildTimeline($("sTrack"), S_STAGES, idx, hold);

      var note = $("sNote");
      var hasNote = m.notes && String(m.notes).trim();
      note.classList.toggle("hidden", !hasNote);
      $("sNoteValue").textContent = hasNote ? m.notes : "";

      $("sAskLink").href = "mailto:" + COMPANY.email +
        "?subject=" + encodeURIComponent("Question about service " + normSerial(m.serial_number));

      result.classList.remove("hidden");
      $("sStatusBig").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      console.error(err);
      showMsg("serviceMsg", "error",
        "We couldn\u2019t reach the service database. Please check your connection and try again in a moment.");
    } finally {
      btn.disabled = false;
    }
  }

  /* wire lookups (form submit handles both click and Enter) */
  $("warrantyForm").addEventListener("submit", function (e) { e.preventDefault(); checkWarranty(); });
  $("serviceForm").addEventListener("submit", function (e) { e.preventDefault(); checkService(); });
  ["warranty", "service"].forEach(function (k) {
    renderRecents(k === "warranty" ? "w" : "s");
  });

  /* "Book a service" button on a warranty result */
  $("wBookBtn").addEventListener("click", function () {
    var serial = this.getAttribute("data-serial") || "";
    $("bkSerial").value = serial;
    switchTab("book");
  });

  /* ================================================================== */
  /* BOOK A SERVICE                                                     */
  /* ================================================================== */
  var dupAckSerial = null;

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }
  function validPhone(v) {
    var digits = String(v).replace(/\D/g, "");
    return digits.length >= 9 && digits.length <= 13;
  }

  function validateBookingForm() {
    var ok = true;
    var pairs = [
      ["bkName", function (v) { return v.length >= 2 ? "" : "Please enter your full name."; }],
      ["bkPhone", function (v) { return validPhone(v) ? "" : "Enter a valid phone number (9\u201313 digits)."; }],
      ["bkLaptop", function (v) { return v ? "" : "Enter the laptop model, e.g. Dell Latitude 5420."; }],
      ["bkSerial", function (v) { return v ? "" : "Enter the serial number from your laptop."; }],
      ["bkPurchase", function (v) {
        if (!v) return "Select the purchase date.";
        if (v > todayISO()) return "Purchase date can\u2019t be in the future.";
        if (v < "1995-01-01") return "That date looks unusual \u2014 please check it.";
        return "";
      }],
      ["bkInvoice", function (v) { return v ? "" : "Enter the invoice number from your purchase."; }]
    ];
    pairs.forEach(function (p) {
      var input = $(p[0]);
      var msg = p[1](normSerial(input.value) || (input.type !== "text" ? String(input.value || "").trim() : ""));
      setFieldError(input, msg);
      if (msg) ok = false;
    });
    return ok;
  }
  function bookingPayload() {
    return {
      serial_number: normSerial($("bkSerial").value),
      customer_name: String($("bkName").value).trim(),
      phone_number: String($("bkPhone").value).trim(),
      laptop_model: String($("bkLaptop").value).trim(),
      purchase_date: $("bkPurchase").value || null,
      invoice_number: normSerial($("bkInvoice").value)
    };
  }

  async function hasOpenBooking(serial) {
    try {
      var res = await sb.from(TABLES.service).select("status")
        .ilike("serial_number", serial)
        .order("id", { ascending: false }).limit(1);
      if (res.error) return null; /* couldn't check — do not block */
      var st = res.data && res.data[0] ? String(res.data[0].status || "").trim() : null;
      return st === null || OPEN_SERVICE_STATUSES.indexOf(st) !== -1;
    } catch (e) { return null; }
  }

  $("bookingForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var form = this;
    var submitBtn = $("bookingSubmitBtn");
    var dupNote = $("bkDupNote");
    var errBox = $("bookingMsg");
    hideMsg("bookingMsg");
    dupNote.classList.remove("show");

    clearFieldErrors(form);
    if (!validateBookingForm()) {
      var firstBad = form.querySelector(".in.invalid");
      if (firstBad) firstBad.focus();
      return;
    }
    var payload = bookingPayload();

    /* Guard against double-clicks while the duplicate check runs */
    submitBtn.disabled = true;
    submitBtn.textContent = "Checking\u2026";

    /* polite duplicate check: warn, then let the customer confirm */
    var open = await hasOpenBooking(payload.serial_number);
    if (open === true && dupAckSerial !== payload.serial_number) {
      dupAckSerial = payload.serial_number;
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Service Request";
      dupNote.classList.add("show");
      dupNote.scrollIntoView({ behavior: "smooth", block: "nearest" });
      $("bkDupText").textContent =
        "We already have an open service request for serial " + payload.serial_number +
        ". If this is a new or different repair, click \u201CSubmit Service Request\u201D once more to confirm and send it anyway.";
      return;
    }
    if (open === true) {
      dupNote.classList.remove("show"); /* confirmed */
    }

    submitBtn.textContent = "Submitting\u2026";
    try {
      var ins = await sb.from(TABLES.service).insert([payload]);
      if (ins.error) throw ins.error;
      dupAckSerial = null;
      /* success panel */
      $("bkDoneSerial").textContent = payload.serial_number;
      $("bkDoneName").textContent = payload.customer_name;
      $("bkDoneLaptop").textContent = payload.laptop_model;
      $("bkDonePhone").textContent = payload.phone_number;
      $("bkDonePurchase").textContent = payload.purchase_date || "—";
      $("bkDoneInvoice").textContent = payload.invoice_number;
      form.classList.add("hidden");
      $("bookingSuccess").classList.remove("hidden");
      $("bookingSuccess").scrollIntoView({ behavior: "smooth", block: "start" });
      form.reset();
      setBookingSent(payload.serial_number);
    } catch (err) {
      console.error(err);
      showMsg("bookingMsg", "error",
        "We couldn\u2019t submit your request \u2014 please try again. If it keeps failing, email " + COMPANY.email + " and we\u2019ll book it for you.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Service Request";
    }
  });

  function setBookingSent(serial) {
    $("bkTrackBtn").setAttribute("data-serial", serial || "");
  }

  /* after success: jump straight to service status */
  $("bkTrackBtn").addEventListener("click", function () {
    var serial = this.getAttribute("data-serial") || "";
    $("serviceLookup").value = serial;
    switchTab("service", { focus: false });
    checkService();
  });
  /* submit another request */
  $("bkAnotherBtn").addEventListener("click", function () {
    $("bookingForm").classList.remove("hidden");
    $("bookingSuccess").classList.add("hidden");
    $("bkSerial").focus();
  });
  /* typing in the serial resets the duplicate-ack so it re-checks */
  $("bkSerial").addEventListener("input", function () {
    dupAckSerial = null;
    $("bkDupNote").classList.remove("show");
  });

  /* ------------------------------------------------------------------ */
  /* Deep link support: index.html?tab=warranty|service|book[&sn=SN]    */
  /* ------------------------------------------------------------------ */
  var params = new URLSearchParams(window.location.search);
  var sn = normSerial(params.get("sn") || "");
  var tab = (params.get("tab") || "").toLowerCase();
  if (["warranty", "service", "book"].indexOf(tab) === -1) tab = sn ? "warranty" : "";
  if (tab) {
    switchTab(tab, { focus: !sn });
    if (sn && tab === "warranty") { $("warrantyLookup").value = sn; checkWarranty(); }
    else if (sn && tab === "service") { $("serviceLookup").value = sn; checkService(); }
    else if (sn && tab === "book") { $("bkSerial").value = sn; }
  }
})();
