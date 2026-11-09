// FA-ImprovedLayout — quick upload on /submit/ (setting "uploader"): FA's three upload pages as one form.
// Several files at once (one submission each, sharing the details), keywords as chips, the last choices
// remembered, and a queue that sends them one after another through FA's own forms:
//   GET /submit/ → POST /submit/upload/ (type + file) → POST /submit/finalize/ (details) → /view/<id>/
// Ideas and FA's field names from the FA-MobileApp uploader. Runs at document_idle after features.js.
(() => {
  "use strict";
  if (!/^\/submit\/?$/.test(location.pathname)) return;
  chrome.storage.sync.get({ enabled: true, uploader: true, lang: "auto" }, (s) => {
    if (!s.enabled || !s.uploader) return;
    fawSetLang(s.lang);
    init();
  });

  function init() {
    const $ = (sel, root = document) => root.querySelector(sel);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    const store = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
    const keep = (obj) => { try { chrome.storage.local.set(obj); } catch (e) { /* extension reloaded */ } };

    // Same as features.js: requests run in the page's context so FA sees a normal request with the login
    // (Firefox: content.fetch, and a page-side FormData so the files cross over).
    const inPage = typeof content !== "undefined" && content && typeof content.fetch === "function";
    const pageFetch = (url, init) => (inPage ? content.fetch(new URL(url, location.href).href, init) : fetch(url, init));
    const newForm = () => (inPage && content.FormData ? new content.FormData() : new FormData());
    async function getDoc(url, init) {
      const res = await pageFetch(url, Object.assign({ credentials: "same-origin" }, init));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return { doc: new DOMParser().parseFromString(await res.text(), "text/html"), url: res.url };
    }

    const RATINGS = [["0", "General"], ["2", "Mature"], ["1", "Adult"]];   // FA's values
    const GENDERS = ["male", "female", "trans_male", "trans_female", "intersex", "non_binary"];
    const GAP_MS = 30000;          // FA's flood protection wants a pause between uploads
    const KW_MAX = 500;            // FA's keyword field length
    const IMG_OK = /^image\/(jpeg|png|gif)$/;
    const typeOf = (f) => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (f.type.startsWith("image/") || /^(jpe?g|png|gif|webp|avif|bmp)$/.test(ext)) return "submission";
      if (f.type.startsWith("audio/") || /^(mp3|wav|mid|midi)$/.test(ext)) return "music";
      if (/^(txt|rtf|doc|docx|odt|pdf)$/.test(ext)) return "story";
      return null;
    };
    // "my_new-pic.png" → "My new pic"
    const titleFrom = (name) => {
      const t = name.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
      return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 60);
    };
    // what FA takes: a-z, 0-9, _ ; "Café-Art" → cafe_art ; at least 3 characters
    const cleanKw = (k) => k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

    // ---------------------------------------------------------------- page
    const faForm = $("form[action*='/submit/upload']") || $("form#myform");
    if (!faForm) return;                                   // not logged in, or FA changed the page
    const faBox = faForm.closest("section") || faForm;
    const maxSize = Number((faForm.querySelector("[name=MAX_FILE_SIZE]") || {}).value) || 10485760;

    const st = {
      files: [],                 // { id, file, type, title, rating, thumb, url }
      rating: "", cat: "1", atype: "1", species: "1", folders: [], newFolder: "",
      lock: false, scrap: false, stripGps: true,
      desc: "", keywords: [], genders: [],
      lists: null, folderList: [], usedKw: [],
      queue: [], running: false
    };

    const panel = el("section", "faw-up");
    const head = el("div", "faw-up__head");
    head.append(el("h2", null, T("upTitle")));
    const classic = el("button", "faw-up__link", T("upClassic"));
    classic.type = "button";
    head.append(classic);
    const body = el("div", "faw-up__body");
    panel.append(head, body);
    faBox.before(panel);
    faBox.classList.add("faw-up-hidden");
    classic.addEventListener("click", () => {
      const show = faBox.classList.toggle("faw-up-hidden");
      classic.textContent = show ? T("upClassic") : T("upHideClassic");
    });

    // ---- files
    const drop = el("label", "faw-up__drop");
    const pick = el("input");
    pick.type = "file"; pick.multiple = true; pick.hidden = true;
    pick.accept = "image/*,.txt,.rtf,.doc,.docx,.odt,.pdf,.mp3,.wav,.mid,.midi";
    drop.append(el("strong", null, T("upDrop")), el("span", null, T("upDropSub")), pick);
    const fileList = el("div", "faw-up__files");
    body.append(drop, fileList);
    pick.addEventListener("change", () => { addFiles(pick.files); pick.value = ""; });
    for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); });
    for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });
    document.addEventListener("paste", (e) => {
      if (e.target.closest && e.target.closest("input, textarea")) return;
      const fs = [...(e.clipboardData ? e.clipboardData.files : [])];
      if (fs.length) { e.preventDefault(); addFiles(fs); }
    });

    function addFiles(list) {
      for (const f of list) {
        const type = typeOf(f);
        if (!type) { note(T("upBadType", f.name), true); continue; }
        st.files.push({ id: Math.random().toString(36).slice(2), file: f, type, title: titleFrom(f.name || "image"), rating: "", thumb: null,
          text: type === "story", url: type === "submission" ? URL.createObjectURL(f) : "" });
      }
      renderFiles();
    }
    function renderFiles() {
      fileList.replaceChildren();
      for (const it of st.files) {
        const row = el("div", "faw-up__file");
        const pv = el("div", "faw-up__pv");
        if (it.url) { const im = el("img"); im.src = it.url; im.alt = ""; pv.append(im); }
        else pv.append(el("span", null, it.type === "music" ? "♪" : "¶"));
        const mid = el("div", "faw-up__fmid");
        const title = el("input", "faw-up__in");
        title.maxLength = 60; title.value = it.title; title.placeholder = T("upTitleField");
        title.addEventListener("input", () => { it.title = title.value; });
        const meta = el("div", "faw-up__fmeta");
        meta.append(el("span", null, it.file.name + " · " + (it.file.size / 1048576).toFixed(1) + " MB"));
        // own rating for this file, or the form's
        const rs = el("select", "faw-up__sel");
        rs.append(new Option(T("upRatingForm"), ""));
        for (const [v, n] of RATINGS) rs.append(new Option(n, v));
        rs.value = it.rating;
        rs.addEventListener("change", () => { it.rating = rs.value; });
        meta.append(rs);
        if (it.text) {                                   // story or poem: FA asks which
          const ts = el("select", "faw-up__sel");
          ts.append(new Option(T("upStory"), "story"), new Option(T("upPoetry"), "poetry"));
          ts.value = it.type;
          ts.addEventListener("change", () => { it.type = ts.value; });
          meta.append(ts);
        }
        if (it.type !== "submission") {                  // stories and music can get a cover
          const cv = el("label", "faw-up__link", it.thumb ? T("upCoverSet", it.thumb.name) : T("upCover"));
          const ci = el("input"); ci.type = "file"; ci.accept = "image/jpeg,image/png,image/gif"; ci.hidden = true;
          ci.addEventListener("change", () => { it.thumb = ci.files[0] || null; renderFiles(); });
          cv.append(ci);
          meta.append(cv);
        }
        mid.append(title, meta);
        const rm = el("button", "faw-up__x", "×");
        rm.type = "button"; rm.title = T("upRemove");
        rm.addEventListener("click", () => { if (it.url) URL.revokeObjectURL(it.url); st.files = st.files.filter((x) => x !== it); renderFiles(); });
        row.append(pv, mid, rm);
        fileList.append(row);
      }
      if (st.files.length > 1) fileList.append(el("p", "faw-up__hint", T("upMany", st.files.length)));
    }

    // ---- details
    const sec = (label, ...kids) => { const s = el("div", "faw-up__sec"); s.append(el("h4", null, label), ...kids); body.append(s); return s; };

    const ratingRow = el("div", "faw-up__seg");
    const ratingBtns = RATINGS.map(([v, n]) => {
      const b = el("button", "faw-up__segbtn r-" + n.toLowerCase(), n);
      b.type = "button";
      b.addEventListener("click", () => { st.rating = v; syncRating(); savePrefs(); });
      ratingRow.append(b);
      return [v, b];
    });
    const syncRating = () => { for (const [v, b] of ratingBtns) b.classList.toggle("is-on", st.rating === v); };
    sec(T("upRating"), ratingRow);

    const bb = el("div", "faw-up__bb");
    const desc = el("textarea", "faw-up__in faw-up__desc");
    desc.rows = 7; desc.maxLength = 65000; desc.placeholder = T("upDescField");
    for (const [label, open, close] of [["B", "[b]", "[/b]"], ["I", "[i]", "[/i]"], ["U", "[u]", "[/u]"], ["S", "[s]", "[/s]"],
      ["⇔", "[center]", "[/center]"], ["❝", "[quote]", "[/quote]"], ["🔗", "[url=]", "[/url]"], [":icon:", ":icon", ":"]]) {
      const b = el("button", "faw-up__bbbtn", label);
      b.type = "button";
      b.addEventListener("click", () => {
        const a = desc.selectionStart, z = desc.selectionEnd, v = desc.value;
        desc.value = v.slice(0, a) + open + v.slice(a, z) + close + v.slice(z);
        desc.focus();
        desc.selectionStart = desc.selectionEnd = z + open.length + (z === a ? 0 : close.length);
        st.desc = desc.value; saveDraft();
      });
      bb.append(b);
    }
    desc.addEventListener("input", () => { st.desc = desc.value; saveDraft(); });
    sec(T("upDesc"), bb, desc);

    // keywords as chips; typing a space, comma or Enter turns the text into a chip
    const kwBox = el("div", "faw-up__kw");
    const kwIn = el("input", "faw-up__kwin");
    kwIn.placeholder = T("upKwField");
    kwIn.setAttribute("list", "faw-up-kwlist");
    const kwList = el("datalist"); kwList.id = "faw-up-kwlist";
    const kwInfo = el("div", "faw-up__hint");
    const genderRow = el("div", "faw-up__chips");
    sec(T("upKeywords"), genderRow, kwBox, kwInfo, kwList);
    const kwText = () => [...st.genders, ...st.keywords].join(" ");
    function addKw(raw) {
      for (const part of String(raw).split(/[\s,;]+/)) {
        const k = cleanKw(part);
        if (k.length < 3 || st.keywords.includes(k) || st.genders.includes(k)) continue;
        if ((kwText() + " " + k).trim().length > KW_MAX) { note(T("upKwFull"), true); break; }
        st.keywords.push(k);
      }
      renderKw(); saveDraft();
    }
    kwIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); addKw(kwIn.value); kwIn.value = ""; }
      else if (e.key === "Backspace" && !kwIn.value && st.keywords.length) { st.keywords.pop(); renderKw(); saveDraft(); }
    });
    kwIn.addEventListener("blur", () => { if (kwIn.value.trim()) { addKw(kwIn.value); kwIn.value = ""; } });
    kwIn.addEventListener("paste", (e) => { e.preventDefault(); addKw(e.clipboardData.getData("text")); });
    kwBox.addEventListener("click", (e) => { if (e.target === kwBox) kwIn.focus(); });
    function renderKw() {
      for (const c of [...kwBox.children]) if (c !== kwIn) c.remove();   // the input stays, keeping focus
      if (!kwIn.parentNode) kwBox.append(kwIn);
      for (const k of st.keywords) {
        const c = el("span", "faw-up__chip", k);
        const x = el("button", null, "×");
        x.type = "button";
        x.addEventListener("click", () => { st.keywords = st.keywords.filter((q) => q !== k); renderKw(); saveDraft(); });
        c.append(x);
        kwBox.insertBefore(c, kwIn);
      }
      genderRow.replaceChildren(el("span", "faw-up__hint", T("upGenders")));
      for (const g of GENDERS) {
        const c = el("button", "faw-up__gchip" + (st.genders.includes(g) ? " is-on" : ""), g.replace("_", " "));
        c.type = "button";
        c.addEventListener("click", () => {
          st.genders = st.genders.includes(g) ? st.genders.filter((q) => q !== g) : st.genders.concat(g);
          renderKw(); saveDraft();
        });
        genderRow.append(c);
      }
      const n = st.genders.length + st.keywords.length;
      kwInfo.textContent = T("upKwCount", n, kwText().length, KW_MAX);
      kwInfo.classList.toggle("is-bad", n < 3);
    }

    // category / theme / species: FA's lists (from the last upload, or the browse page until then)
    const selRow = el("div", "faw-up__row");
    const mkSel = (key) => {
      const s = el("select", "faw-up__sel faw-up__sel--wide");
      s.addEventListener("change", () => { st[key] = s.value; savePrefs(); });
      return s;
    };
    const catSel = mkSel("cat"), themeSel = mkSel("atype"), specSel = mkSel("species");
    for (const [l, s] of [[T("category"), catSel], [T("upTheme"), themeSel], [T("species"), specSel]]) {
      const w = el("label", "faw-up__field"); w.append(el("span", null, l), s); selRow.append(w);
    }
    sec(T("upCatSpecies"), selRow);
    function fillSel(s, html, value) {
      s.replaceChildren();
      if (!html) { s.append(new Option("—", value || "1")); return; }
      const tmp = new DOMParser().parseFromString("<select>" + html + "</select>", "text/html").querySelector("select");
      for (const n of [...tmp.children]) s.append(document.importNode(n, true));
      s.value = value;
      if (s.value !== value) s.selectedIndex = 0;
    }

    // folders: known from the last finalize page; a new one can always be named
    const folderBox = el("div", "faw-up__folders");
    const newFolder = el("input", "faw-up__in");
    newFolder.placeholder = T("upNewFolder"); newFolder.maxLength = 60;
    newFolder.addEventListener("input", () => { st.newFolder = newFolder.value; });
    sec(T("upFolders"), folderBox, newFolder);
    function renderFolders() {
      folderBox.replaceChildren();
      if (!st.folderList.length) { folderBox.append(el("p", "faw-up__hint", T("upFoldersLater"))); return; }
      let group = null;
      for (const f of st.folderList) {
        if (f.g !== group) { group = f.g; if (group) folderBox.append(el("h5", null, group)); }
        const l = el("label", "faw-up__check");
        const c = el("input"); c.type = "checkbox"; c.checked = st.folders.includes(f.v);
        c.addEventListener("change", () => {
          st.folders = c.checked ? st.folders.concat(f.v) : st.folders.filter((q) => q !== f.v);
          savePrefs();
        });
        l.append(c, " " + f.n);
        folderBox.append(l);
      }
    }

    const opts = el("div", "faw-up__row");
    const check = (key, label) => {
      const l = el("label", "faw-up__check");
      const c = el("input"); c.type = "checkbox";
      c.addEventListener("change", () => { st[key] = c.checked; savePrefs(); });
      l.append(c, " " + label);
      opts.append(l);
      return c;
    };
    const lockC = check("lock", T("upLock")), scrapC = check("scrap", T("upScrap")), gpsC = check("stripGps", T("upGps"));
    sec(T("upOptions"), opts);

    // ---- send + queue
    const foot = el("div", "faw-up__foot");
    const go = el("button", "faw-up__go", T("upSend"));
    go.type = "button";
    const msg = el("div", "faw-up__msg");
    foot.append(msg, go);
    body.append(foot);
    const queueBox = el("div", "faw-up__queue");
    body.append(queueBox);
    function note(text, bad) { msg.textContent = text; msg.classList.toggle("is-bad", !!bad); }

    go.addEventListener("click", () => {
      const problems = [];
      if (!st.files.length) problems.push(T("upNeedFile"));
      if (!st.rating && st.files.some((f) => !f.rating)) problems.push(T("upNeedRating"));
      if (!st.desc.trim()) problems.push(T("upNeedDesc"));
      if (st.genders.length + st.keywords.length < 3) problems.push(T("upNeedKw"));
      for (const f of st.files) if (!f.title.trim()) f.title = titleFrom(f.file.name || "image");
      if (problems.length) { note(problems.join(" · "), true); return; }
      // everything but the files is shared: a snapshot per file, so the form can be reused right away
      const shared = { cat: st.cat, atype: st.atype, species: st.species, folders: st.folders.slice(), newFolder: st.newFolder.trim(),
        lock: st.lock, scrap: st.scrap, stripGps: st.stripGps, desc: st.desc, keywords: kwText() };
      for (const f of st.files) st.queue.push(Object.assign({}, f, { rating: f.rating || st.rating, shared, state: "wait", info: "" }));
      keep({ uploadKeywords: [...new Set([...st.keywords, ...st.usedKw])].slice(0, 300) });
      st.usedKw = [...new Set([...st.keywords, ...st.usedKw])];
      st.files = []; st.newFolder = ""; newFolder.value = "";
      keep({ uploadDraft: null });
      renderFiles(); renderQueue();
      note(T("upQueued"));
      runQueue();
    });

    function renderQueue() {
      queueBox.replaceChildren();
      if (!st.queue.length) return;
      queueBox.append(el("h4", null, T("upQueue")));
      for (const q of st.queue) {
        const row = el("div", "faw-up__qrow is-" + q.state);
        row.append(el("span", "faw-up__qtitle", q.title));
        const info = el("span", "faw-up__qinfo");
        if (q.state === "done") {
          const a = el("a", null, T("upDone")); a.href = q.link; a.target = "_blank"; info.append(a);
        } else {
          info.textContent = q.info || T("upWaiting");
        }
        if (q.state === "fail") {
          const r = el("button", "faw-up__link", T("retry"));
          r.type = "button";
          r.addEventListener("click", () => { q.state = "wait"; q.info = ""; renderQueue(); runQueue(); });
          info.append(" ", r);
        }
        row.append(info);
        queueBox.append(row);
      }
      if (st.running) queueBox.append(el("p", "faw-up__hint", T("upKeepOpen")));
    }
    window.addEventListener("beforeunload", (e) => { if (st.running) { e.preventDefault(); e.returnValue = ""; } });

    let lastSent = 0;
    async function runQueue() {
      if (st.running) return;
      st.running = true;
      try {
        for (let q; (q = st.queue.find((x) => x.state === "wait"));) {
          // FA's flood protection: keep a pause after the previous upload, with a countdown
          while (Date.now() - lastSent < GAP_MS) {
            q.info = T("upPause", Math.ceil((GAP_MS - (Date.now() - lastSent)) / 1000)); renderQueue();
            await sleep(1000);
          }
          await sendOne(q);
          lastSent = Date.now();
          renderQueue();
        }
      } finally { st.running = false; renderQueue(); }
    }

    async function sendOne(q) {
      q.state = "busy";
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          q.info = T("upPreparing"); renderQueue();
          const file = q.type === "submission" ? await fitImage(q.file, q.shared.stripGps) : q.file;
          // 1) fresh upload form (its key)
          const { doc } = await getDoc("/submit/");
          const f1 = doc.querySelector("form[action*='/submit/upload']") || doc.querySelector("form#myform");
          if (!f1) throw new Error(pageError(doc) || T("upNoForm"));
          const fd = newForm();
          for (const i of f1.querySelectorAll("input[type=hidden][name]")) fd.append(i.name, i.value);
          fd.append("submission_type", q.type);
          const fileInputs = [...f1.querySelectorAll("input[type=file][name]")];
          fd.append((fileInputs[0] && fileInputs[0].name) || "submission", file, file.name);
          if (q.thumb) fd.append((fileInputs[1] && fileInputs[1].name) || "thumbnail", q.thumb, q.thumb.name);
          q.info = T("upSending", (file.size / 1048576).toFixed(1)); renderQueue();
          const r1 = await getDoc(new URL(f1.getAttribute("action") || "/submit/upload/", location.origin).href, { method: "POST", body: fd });
          // 2) details form
          const f2 = r1.doc.querySelector("form[action*='finalize']");
          if (!f2) throw new Error(pageError(r1.doc) || T("upNoFinalize"));
          rememberLists(f2);
          q.info = T("upFinishing"); renderQueue();
          const r2 = await getDoc(new URL(f2.getAttribute("action"), location.origin).href, { method: "POST", body: finalizeData(f2, q) });
          const id = (r2.url.match(/\/view\/(\d+)/) || [])[1];
          if (!id) throw new Error(pageError(r2.doc) || T("upUnknown"));
          q.state = "done"; q.link = "/view/" + id + "/"; q.info = "";
          return;
        } catch (err) {
          const wait = String(err.message).match(/flood protection[^0-9]*(\d+)\s*second/i);
          if (wait && attempt < 3) {                    // FA says how long; wait it out and try again
            for (let s = Number(wait[1]) + 2; s > 0; s--) { q.info = T("upPause", s); renderQueue(); await sleep(1000); }
            continue;
          }
          q.state = "fail"; q.info = T("upFailed", err.message);
          return;
        }
      }
    }

    // FA's finalize form with its own defaults, our choices on top (select options by value, else label)
    function finalizeData(form, q) {
      const s = q.shared, fd = newForm();
      for (const i of form.querySelectorAll("input[type=hidden][name]")) fd.append(i.name, i.value);
      const pickSel = (name, want, wantLabel) => {
        const sel = form.querySelector(`select[name="${name}"]`);
        if (!sel) return;
        const o = [...sel.options].find((x) => x.value === want) || [...sel.options].find((x) => wantLabel && x.textContent.trim() === wantLabel)
          || sel.selectedOptions[0] || sel.options[0];
        if (o) fd.append(name, o.value);
      };
      const label = (s2, v) => { const o = [...s2.options].find((x) => x.value === v); return o ? o.textContent.trim() : ""; };
      pickSel("cat", s.cat, label(catSel, s.cat));
      pickSel("atype", s.atype, label(themeSel, s.atype));
      pickSel("species", s.species, label(specSel, s.species));
      for (const sel of form.querySelectorAll("select[name]")) {     // any other list FA adds keeps its default
        if (!["cat", "atype", "species"].includes(sel.name) && sel.selectedOptions[0]) fd.append(sel.name, sel.selectedOptions[0].value);
      }
      fd.append("rating", q.rating);
      fd.append("title", q.title.trim().slice(0, 60));
      fd.append("message", s.desc);
      fd.append("keywords", s.keywords);
      if (s.lock && form.querySelector("[name=lock_comments]")) fd.append("lock_comments", "1");
      if (s.scrap && form.querySelector("[name=scrap]")) fd.append("scrap", "1");
      for (const c of form.querySelectorAll("input[name='folder_ids[]']")) if (s.folders.includes(c.value)) fd.append("folder_ids[]", c.value);
      if (s.newFolder && form.querySelector("[name=create_folder_name]")) fd.append("create_folder_name", s.newFolder);
      const btn = form.querySelector("[type=submit][name]");
      if (btn) fd.append(btn.name, btn.value || "Finalize");
      return fd;
    }

    // FA's message on an error page ("Flood protection. Please wait 16 seconds …", "Upload failed …")
    function pageError(doc) {
      const n = doc.querySelector(".redirect-message, .notice-message, #standardpage .section-body, .section-body");
      const t = n ? n.textContent.replace(/\s+/g, " ").trim() : (doc.title || "");
      return t.slice(0, 200);
    }

    // lists and folders as FA's finalize page has them, kept for the next upload
    function rememberLists(form) {
      const html = (n) => { const s = form.querySelector(`select[name="${n}"]`); return s ? s.innerHTML : ""; };
      const lists = { cat: html("cat"), atype: html("atype"), species: html("species") };
      const folders = [];
      for (const c of form.querySelectorAll("input[name='folder_ids[]']")) {
        const l = form.querySelector(`label[for="${c.id}"]`);
        let g = "", p = c.closest(".folder_name") || c;
        while ((p = p.previousElementSibling)) if (/^H\d$/.test(p.tagName)) { g = p.textContent.trim(); break; }
        folders.push({ v: c.value, n: (l ? l.textContent : c.value).trim(), g });
      }
      keep({ uploadLists: lists, uploadFolders: folders });
      if (lists.cat) st.lists = lists;
      st.folderList = folders;
      renderFolders();
    }

    // ---------------------------------------------------------------- image files
    // FA takes JPEG, PNG and GIF up to MAX_FILE_SIZE. Other types are converted; too large pictures are
    // re-encoded, then scaled down until they fit. JPEG location data (EXIF) is removed if wanted.
    async function fitImage(file, stripGps) {
      let f = file;
      if (f.type === "image/jpeg" && stripGps) f = await stripExif(f);
      if (IMG_OK.test(f.type) && f.size <= maxSize) return f;
      if (f.type === "image/gif" && f.size > maxSize) throw new Error(T("upGifBig"));
      const bmp = await createImageBitmap(f).catch(() => { throw new Error(T("upCantRead")); });
      const base = (file.name || "image").replace(/\.[^.]+$/, "");
      let scale = 1;
      for (let i = 0; i < 12; i++) {
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        // PNG keeps transparency; when that's too big (or after the first try) JPEG at falling quality
        const png = i === 0 ? await new Promise((r) => c.toBlob(r, "image/png")) : null;
        if (png && png.size <= maxSize) return new File([png], base + ".png", { type: "image/png" });
        for (const qy of [0.92, 0.85, 0.75]) {
          const jpg = await new Promise((r) => c.toBlob(r, "image/jpeg", qy));
          if (jpg && jpg.size <= maxSize) return new File([jpg], base + ".jpg", { type: "image/jpeg" });
        }
        scale *= 0.85;
      }
      throw new Error(T("upTooBig"));
    }
    // Drops the EXIF block (APP1 "Exif") from a JPEG without re-encoding it. A photo that relies on the
    // EXIF orientation is re-encoded upright instead, so it doesn't end up sideways.
    async function stripExif(file) {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf[0] !== 0xFF || buf[1] !== 0xD8) return file;
      const parts = [buf.subarray(0, 2)];
      let p = 2, removed = false, rotated = false;
      while (p + 4 <= buf.length && buf[p] === 0xFF) {
        const m = buf[p + 1], len = (buf[p + 2] << 8) | buf[p + 3];
        if (m === 0xDA) break;                                         // image data starts: keep the rest
        const seg = buf.subarray(p, p + 2 + len);
        const isExif = m === 0xE1 && String.fromCharCode(...seg.subarray(4, 8)) === "Exif";
        if (isExif) { removed = true; rotated = exifOrientation(seg) > 1; } else parts.push(seg);
        p += 2 + len;
      }
      if (!removed) return file;
      if (rotated) {                                                   // bake the rotation in
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
        const c = document.createElement("canvas");
        c.width = bmp.width; c.height = bmp.height;
        c.getContext("2d").drawImage(bmp, 0, 0);
        const jpg = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
        return new File([jpg], file.name, { type: "image/jpeg" });
      }
      parts.push(buf.subarray(p));
      return new File(parts, file.name, { type: "image/jpeg" });
    }
    function exifOrientation(seg) {
      const t = 10, le = seg[t] === 0x49;                               // TIFF header after "Exif\0\0"
      const u16 = (o) => (le ? seg[t + o] | (seg[t + o + 1] << 8) : (seg[t + o] << 8) | seg[t + o + 1]);
      const u32 = (o) => (le ? (u16(o) | (u16(o + 2) << 16)) : ((u16(o) << 16) | u16(o + 2))) >>> 0;
      try {
        const ifd = u32(4), n = u16(ifd);
        for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === 0x0112) return u16(ifd + 2 + i * 12 + 8);
      } catch (e) { /* malformed: treat as upright */ }
      return 1;
    }

    // ---------------------------------------------------------------- remembered state
    let draftTimer = null;
    function saveDraft() {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => keep({ uploadDraft: { desc: st.desc, keywords: st.keywords, genders: st.genders } }), 400);
    }
    function savePrefs() {
      keep({ uploadPrefs: { rating: st.rating, cat: st.cat, atype: st.atype, species: st.species, folders: st.folders,
        lock: st.lock, scrap: st.scrap, stripGps: st.stripGps } });
    }

    (async () => {
      const l = await store({ uploadPrefs: {}, uploadDraft: null, uploadLists: null, uploadFolders: [], uploadKeywords: [] });
      Object.assign(st, {
        rating: "", cat: "1", atype: "1", species: "1", folders: [], lock: false, scrap: false, stripGps: true
      }, l.uploadPrefs || {});
      if (l.uploadDraft) Object.assign(st, { desc: l.uploadDraft.desc || "", keywords: l.uploadDraft.keywords || [], genders: l.uploadDraft.genders || [] });
      st.folderList = Array.isArray(l.uploadFolders) ? l.uploadFolders : [];
      st.usedKw = Array.isArray(l.uploadKeywords) ? l.uploadKeywords : [];
      for (const k of st.usedKw.slice(0, 300)) kwList.append(new Option(k));
      desc.value = st.desc;
      lockC.checked = st.lock; scrapC.checked = st.scrap; gpsC.checked = st.stripGps;
      syncRating(); renderKw(); renderFolders(); renderFiles();
      // FA's lists: from the last finalize page, else from the browse page (same values)
      st.lists = l.uploadLists && l.uploadLists.cat ? l.uploadLists : null;
      if (!st.lists) {
        try {
          const { doc } = await getDoc("/browse/");
          const h = (n) => { const s = doc.querySelector(`select[name="${n}"]`); return s ? s.innerHTML : ""; };
          st.lists = { cat: h("cat"), atype: h("atype"), species: h("species") };
        } catch (e) { st.lists = {}; }
      }
      fillSel(catSel, st.lists.cat, st.cat);
      fillSel(themeSel, st.lists.atype, st.atype);
      fillSel(specSel, st.lists.species, st.species);
      st.cat = catSel.value; st.atype = themeSel.value; st.species = specSel.value;
    })();
  }
})();
