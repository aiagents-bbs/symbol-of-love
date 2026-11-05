/* ================================================================
   ecom-tracker.js — ECOM TRACKER SNIPPET (standalone file)
   One paste-and-go tracker for ANY landing page:
   Meta Pixel + standard events + admin-API send (for server-side
   CAPI) + visitor behaviour tracker.
   Extracted verbatim from the Symbol of Love landing page
   (landing-page-demo, v4) on 2026-11-05. Do not edit the code
   below — configure it only through the script tag (see paste
   line at the bottom of the usage doc) or window.ECOM_CONFIG.

   ONE-LINE PASTE (put just before </body>):
   <script id="ecom-tracker" src="https://aiagents-bbs.github.io/symbol-of-love/ecom-tracker.js" data-api="https://ecom.sagor.me/api" data-product-id="YOUR-PRODUCT-ID" data-product-price="890" data-currency="BDT"></script>

   Configuration, in priority order:
     1. data-* attributes on the loading <script> tag:
          data-api            admin API base (required)
          data-product-id     this page's product id
          data-product-price  unit price (for ViewContent)
          data-currency       e.g. BDT
          data-pixel-id       OPTIONAL override — normally omit;
                              the single shared Pixel ID is fetched
                              at runtime from the admin API.
          Mark the order-total element with  data-ecom-total
          and the quantity element with     data-ecom-qty
          so InitiateCheckout reads the live totals.
     2. window.ECOM_CONFIG = { apiBase, pixelId, productId,
          price, currency } defined before this snippet.
     3. Runtime fetch: GET {api}/tracking-config (public) —
          returns the ONE Pixel ID the owner entered in the
          admin panel. It never returns any CAPI token.
   If no Pixel ID is available from any source, the Pixel stays
   fully disabled (fbevents.js is never loaded), while the API
   event queue and the behaviour tracker still run.
   Behaviour data goes ONLY to the admin API, never to Meta,
   and never contains typed field values or personal data.
   Everything is fail-soft: a dead API never blocks the page
   or the order form.
   Page hook for purchases (call on successful order submit):
     EcomTracker.purchase(orderId, { value, quantity, phone })
   where orderId = EcomTracker.newOrderId() — the SAME id is
   the order's ID, the Pixel Purchase eventID and the API
   event_id, so Meta deduplicates browser + CAPI copies.
   ================================================================ */
(function(){
  "use strict";
  if(window.EcomTracker) return; /* install once */

  /* ---------- configuration ---------- */
  var scriptEl = document.currentScript || document.getElementById("ecom-tracker");
  var ds = (scriptEl && scriptEl.dataset) || {};
  var EC = window.ECOM_CONFIG || {};
  var cfg = {
    apiBase:   (ds.api        || EC.apiBase   || "https://ecom.sagor.me/api").replace(/\/+$/, ""),
    pixelId:   ds.pixelId    || EC.pixelId    || "",
    productId: ds.productId  || EC.productId  || "",
    price:     parseFloat(ds.productPrice != null && ds.productPrice !== "" ? ds.productPrice : EC.price) || 0,
    currency:  ds.currency   || EC.currency   || "BDT"
  };

  /* ---------- helpers ---------- */
  function uid(prefix){
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", rand = "";
    for(var i = 0; i < 4; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
    return prefix + Date.now() + "-" + rand;
  }
  function newEventId(){ return uid("EV-"); }
  function cookieVal(name){
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : undefined;
  }
  function sha256Hex(text){
    if(!(window.crypto && crypto.subtle && crypto.subtle.digest)) return Promise.resolve(undefined);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function(hash){
      var bytes = new Uint8Array(hash), hex = "";
      for(var i = 0; i < bytes.length; i++) hex += ("0" + bytes[i].toString(16)).slice(-2);
      return hex;
    }).catch(function(){ return undefined; });
  }
  function normalizePhone(raw){ /* digits only, with country code */
    var d = String(raw || "").replace(/\D/g, "");
    if(d.indexOf("880") === 0) return d;
    if(d.charAt(0) === "0") return "880" + d.slice(1);
    return d;
  }
  function parseNum(text){ /* reads Latin, Bengali and Arabic-Indic digits */
    if(text == null) return NaN;
    var map = {"০":"0","১":"1","২":"2","৩":"3","৪":"4","৫":"5","৬":"6","৭":"7","৮":"8","৯":"9",
               "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9"};
    var out = "", s = String(text);
    for(var i = 0; i < s.length; i++){
      var c = s.charAt(i);
      if(map[c]) out += map[c];
      else if(/[0-9.]/.test(c)) out += c;
    }
    return parseFloat(out);
  }
  function markedNum(attr){
    var el = document.querySelector("[" + attr + "]");
    return el ? parseNum(el.textContent) : NaN;
  }
  function apiPost(path, payload){
    try {
      return fetch(cfg.apiBase + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function(err){ console.warn("[ecom-tracker] API unreachable (" + path + "):", err); });
    } catch(err) {
      console.warn("[ecom-tracker] API send failed (" + path + "):", err);
      return Promise.resolve();
    }
  }

  /* ---------- Meta Pixel (official base code) ---------- */
  var pixelState = "pending"; /* pending -> on | off */
  var fbqQueue = [];
  function loadPixel(id){
    if(pixelState === "on" || !id) return;
    !function(f,b,e,v,n,t,s){
      if(f.fbq) return; n = f.fbq = function(){ n.callMethod ?
        n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if(!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0";
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    fbq("init", id);
    fbq("track", "PageView");
    pixelState = "on";
    var q = fbqQueue; fbqQueue = [];
    q.forEach(function(args){ try { fbq.apply(null, args); } catch(err){} });
  }
  function pixelOff(){ if(pixelState !== "on"){ pixelState = "off"; fbqQueue = []; } }
  if(cfg.pixelId){
    loadPixel(cfg.pixelId);
  } else {
    /* Runtime config: the owner enters the ONE Pixel ID in the admin
       panel; the public endpoint returns only that ID (never a token). */
    try {
      fetch(cfg.apiBase + "/tracking-config", { method: "GET" })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){
          var id = j && (j.pixel_id || j.pixelId || (j.data && (j.data.pixel_id || j.data.pixelId)));
          if(id) loadPixel(String(id)); else pixelOff();
        })
        .catch(function(err){ console.warn("[ecom-tracker] tracking-config unavailable:", err); pixelOff(); });
    } catch(err) { pixelOff(); }
  }

  /* ---------- conversion events: Pixel + admin API (CAPI relay) ---------- */
  function trackEvent(eventName, eventId, customData, rawPhone){
    if(pixelState === "on"){
      try { fbq("track", eventName, customData, { eventID: eventId }); } catch(err){}
    } else if(pixelState === "pending"){
      fbqQueue.push(["track", eventName, customData, { eventID: eventId }]);
    }
    var send = function(phHash){
      var userData = {};
      if(phHash) userData.ph = phHash;
      var fbp = cookieVal("_fbp"); if(fbp) userData.fbp = fbp;
      var fbc = cookieVal("_fbc"); if(fbc) userData.fbc = fbc;
      apiPost("/events", {
        event_name: eventName,
        event_id: eventId,
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: document.URL,
        action_source: "website",
        user_data: userData,
        custom_data: customData
      });
    };
    if(rawPhone) sha256Hex(normalizePhone(rawPhone)).then(send, function(){ send(undefined); });
    else send(undefined);
  }

  /* ViewContent — once per page load, own unique event ID. */
  if(cfg.productId){
    trackEvent("ViewContent", newEventId(), {
      content_ids: [cfg.productId],
      content_type: "product",
      value: cfg.price,
      currency: cfg.currency
    });
  }

  /* ---------- visitor behaviour tracker (first-party only) ---------- */
  var BH = {
    sessionId: uid("S-"),
    startedAt: Date.now(),
    activeSeconds: 0,
    lastActivity: Date.now(),
    clicks: [],
    scrollMax: 0,
    milestones: [],
    formStarted: false,
    formFields: [],
    formSubmitted: false
  };
  ["click", "keydown", "scroll", "touchstart", "mousemove"].forEach(function(evt){
    document.addEventListener(evt, function(){ BH.lastActivity = Date.now(); }, { passive: true });
  });
  setInterval(function(){
    if(!document.hidden && (Date.now() - BH.lastActivity) < 30000) BH.activeSeconds++;
  }, 1000);
  function scrollPct(){
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if(max <= 0) return 100;
    return Math.min(100, Math.round(((window.scrollY || doc.scrollTop) / max) * 100));
  }
  window.addEventListener("scroll", function(){
    var p = scrollPct();
    if(p > BH.scrollMax) BH.scrollMax = p;
    [25, 50, 75, 100].forEach(function(m){
      if(p >= m && BH.milestones.indexOf(m) === -1) BH.milestones.push(m);
    });
  }, { passive: true });
  function clickLabel(el){
    if(!el || !el.closest) return "page";
    var t;
    if((t = el.closest("[data-track-label]"))) return t.getAttribute("data-track-label");
    if((t = el.closest(".piece-tab"))) return "Flavour tab: " + t.textContent.trim();
    if((t = el.closest("summary"))) return "FAQ item: " + t.textContent.trim();
    if((t = el.closest('a[href*="wa.me"], a[href*="whatsapp"]'))) return "WhatsApp button";
    if(el.closest("#waBtn")) return "WhatsApp button";
    if(el.closest("#copyBtn")) return "Copy order details button";
    if(el.closest('button[type="submit"], input[type="submit"]')) return "Order submit button";
    if(el.closest("#qtyPlus")) return "Quantity plus button";
    if(el.closest("#qtyMinus")) return "Quantity minus button";
    if(el.closest(".top-cta")) return "Header order CTA";
    if(el.closest(".sticky-bar .btn")) return "Sticky bar order CTA";
    if(el.closest(".hero .btn")) return "Hero CTA";
    if((t = el.closest("input, textarea, select"))) return "Form field: " + (t.id || t.name || t.tagName.toLowerCase());
    if((t = el.closest('a[href^="#"]'))) return "Section link: " + t.getAttribute("href");
    var sec = el.closest("section, header, footer, .hero, .strip");
    var where = sec ? (sec.id || (sec.className || "page").split(" ")[0]) : "page";
    return "Click in section: " + where;
  }
  document.addEventListener("click", function(e){
    if(BH.clicks.length >= 200) return;
    BH.clicks.push({ label: clickLabel(e.target), at_active_seconds: BH.activeSeconds });
  }, true);
  function behaviorPayload(kind){
    return {
      type: kind,
      session_id: BH.sessionId,
      page_url: document.URL,
      product_id: cfg.productId,
      sent_at: Math.floor(Date.now() / 1000),
      active_seconds: BH.activeSeconds,
      wall_seconds: Math.round((Date.now() - BH.startedAt) / 1000),
      clicks: BH.clicks.slice(),
      scroll_max_percent: BH.scrollMax,
      scroll_milestones: BH.milestones.slice(),
      form: {
        started: BH.formStarted,
        fields_reached: BH.formFields.slice(),
        submitted: BH.formSubmitted,
        abandoned: BH.formStarted && !BH.formSubmitted && kind === "session_end"
      }
    };
  }
  function sendBehavior(kind){
    if(kind === "session_end" && navigator.sendBeacon){
      try {
        var blob = new Blob([JSON.stringify(behaviorPayload(kind))], { type: "application/json" });
        if(navigator.sendBeacon(cfg.apiBase + "/behavior", blob)) return;
      } catch(err){ /* fall through to fetch */ }
    }
    apiPost("/behavior", behaviorPayload(kind));
  }
  setInterval(function(){ sendBehavior("heartbeat"); }, 15000);
  window.addEventListener("pagehide", function(){ sendBehavior("session_end"); });

  /* ---------- checkout funnel (generic form binding) ---------- */
  var checkoutFired = false;
  function currentQty(){ var q = markedNum("data-ecom-qty"); return isNaN(q) || q < 1 ? 1 : Math.round(q); }
  function currentTotal(){ var v = markedNum("data-ecom-total"); return isNaN(v) ? cfg.price * currentQty() : v; }
  document.addEventListener("focusin", function(e){
    var el = e.target;
    if(!el || !el.closest || !el.closest("form")) return;
    if(!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    BH.formStarted = true;
    var fid = el.id || el.name;
    if(fid && BH.formFields.indexOf(fid) === -1) BH.formFields.push(fid);
    if(checkoutFired || !cfg.productId) return;
    checkoutFired = true;
    var q = currentQty();
    trackEvent("InitiateCheckout", newEventId(), {
      content_ids: [cfg.productId],
      content_type: "product",
      value: currentTotal(),
      currency: cfg.currency,
      num_items: q,
      contents: [{ id: cfg.productId, quantity: q }]
    });
  });

  /* ---------- public API for the host page ---------- */
  var purchased = false;
  window.EcomTracker = {
    newOrderId: function(){ return uid("EC-"); },
    track: function(eventName, customData){ trackEvent(eventName, newEventId(), customData || {}); },
    /* Call ONLY on a successful order submit. eventID === orderId. */
    purchase: function(orderId, opts){
      if(purchased || !orderId) return;
      purchased = true;
      BH.formSubmitted = true;
      opts = opts || {};
      var q = opts.quantity || currentQty();
      trackEvent("Purchase", orderId, {
        content_ids: [cfg.productId],
        content_type: "product",
        value: opts.value != null ? opts.value : currentTotal(),
        currency: cfg.currency,
        contents: [{ id: cfg.productId, quantity: q }],
        order_id: orderId
      }, opts.phone);
    }
  };
})();
