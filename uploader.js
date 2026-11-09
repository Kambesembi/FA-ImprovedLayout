// FA-ImprovedLayout — quick upload on /submit/ (setting "uploader"): FA's three upload pages as one screen.
// Several files at once (one submission each, sharing the details; a file can be set apart for its own
// description and keywords), keywords as chips, settings copied from one of your own submissions, the last
// choices remembered, and a queue that sends the files one after another through FA's own forms:
//   GET /submit/ → POST /submit/upload/ (type + file) → POST /submit/finalize/ (details) → /view/<id>/
// The form's files and the queue are kept in IndexedDB ("faw-upload"), so a reload or a closed tab loses
// nothing: the queue goes on when the upload page is open again. Only one FA tab sends at a time
// (a heartbeat in storage.local, "uploadRunner").
// Layout: three panels side by side (files · text · details) that fit the window, FA's banner hidden.
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
    const btn = (cls, text, onClick) => { const b = el("button", cls, text); b.type = "button"; if (onClick) b.addEventListener("click", onClick); return b; };
    // storage.local; calls fail quietly once the extension was reloaded under an open tab
    const store = (keys) => new Promise((r) => { try { chrome.storage.local.get(keys, r); } catch (e) { r(keys); } });
    const keepNow = (obj) => new Promise((r) => { try { chrome.storage.local.set(obj, r); } catch (e) { r(); } });
    const keep = (obj) => { keepNow(obj); };
    const parse = (html) => new DOMParser().parseFromString(html, "text/html");
    const netErr = () => Object.assign(new Error(T("upNetwork")), { net: true });
    const viewId = (u) => Number((String(u || "").match(/\/view\/(\d+)/) || [])[1]) || 0;

    // Same as features.js: requests run in the page's context so FA sees a normal request with the login
    // (Firefox: content.fetch / content.XMLHttpRequest, and a page-side FormData so the files cross over).
    const inPage = typeof content !== "undefined" && content && typeof content.fetch === "function";
    const pageFetch = (url, init) => (inPage ? content.fetch(new URL(url, location.href).href, init) : fetch(url, init));
    const newForm = () => (inPage && content.FormData ? new content.FormData() : new FormData());
    const isCheck = (status, text) => (status === 403 || status === 503) && /challenge-platform|cf-chl|Just a moment/i.test(text);
    async function getDoc(url, init) {
      let res;
      try { res = await pageFetch(url, Object.assign({ credentials: "same-origin" }, init)); } catch (e) { throw netErr(); }
      const text = await res.text();
      if (isCheck(res.status, text)) throw new Error(T("upCheck"));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return { doc: parse(text), url: res.url };
    }
    // the file upload, with progress (XMLHttpRequest; fetch can't report what's been sent)
    function postFile(url, body, onProgress) {
      let x = null;
      try { x = inPage && content.XMLHttpRequest ? new content.XMLHttpRequest() : new XMLHttpRequest(); } catch (e) { x = null; }
      if (!x) return getDoc(url, { method: "POST", body });
      return new Promise((resolve, reject) => {
        x.open("POST", new URL(url, location.href).href);
        x.withCredentials = true;
        try { x.upload.addEventListener("progress", (e) => { if (e.lengthComputable && e.total) onProgress(e.loaded / e.total); }); } catch (e) { /* no progress then */ }
        x.addEventListener("load", () => {
          const text = String(x.responseText || "");
          if (isCheck(x.status, text)) reject(new Error(T("upCheck")));
          else if (x.status < 200 || x.status >= 300) reject(new Error("HTTP " + x.status));
          else resolve({ doc: parse(text), url: x.responseURL });
        });
        x.addEventListener("error", () => reject(netErr()));
        x.addEventListener("abort", () => reject(netErr()));
        x.send(body);
      });
    }

    const RATINGS = [["0", "General"], ["2", "Mature"], ["1", "Adult"]];   // FA's values
    const GENDERS = ["male", "female", "trans_male", "trans_female", "intersex", "non_binary"];
    const GAP_MS = 30000;          // FA's flood protection wants a pause between uploads
    const KW_MAX = 500;            // FA's keyword field length
    const KEEP_DONE = 20;          // finished uploads kept in the list
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
    const mb = (n) => (n / 1048576).toFixed(1);

    // BBCode → DOM nodes (no HTML parsing: user text only ever becomes text nodes), with the class names
    // FA's own stylesheet uses for descriptions, so the preview looks like the submission page.
    // Unknown or unmatched tags stay as typed text, the way FA leaves them.
    const BB_TAGS = {
      b: "strong", i: "i", u: "u", s: "s", sup: "sup", sub: "sub",
      left: "span.bbcode_left", center: "span.bbcode_center", right: "span.bbcode_right",
      quote: "span.bbcode_quote", spoiler: "span.bbcode_spoiler", color: "span", url: "a", yt: "a",
      h1: "h1.bbcode_h1", h2: "h2.bbcode_h2", h3: "h3.bbcode_h3", h4: "h4.bbcode_h4", h5: "h5.bbcode_h5"
    };
    const BB_RE = /\[(\/?)([a-z0-9]+)(?:=([^\]\n]*))?\]|:icon([\w.~-]+):|:link([\w.~-]+):|:([\w.~-]+)icon:|(https?:\/\/[^\s[\]<>"]+)|^-{5,}[ \t]*(?:\n|$)|\n/gim;
    const safeUrl = (u) => { try { const x = new URL(u.trim()); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } };
    const userBits = (name, icon, label) => {
      const slug = name.toLowerCase().replace(/[^a-z0-9._~-]/g, "");
      const a = el("a", icon ? "iconusername" : "linkusername");
      a.href = "/user/" + slug + "/";
      if (icon) {
        const im = el("img");
        im.src = "https://a.furaffinity.net/" + slug + ".gif";
        im.alt = name; im.title = name;
        a.append(im);
        if (label) a.append(" " + name);
      } else a.textContent = name;
      return a;
    };
    function bbcode(text) {
      const root = el("div", "bbcode faw-up__bbout");
      const stack = [{ tag: "", node: root }];
      const top = () => stack[stack.length - 1].node;
      let last = 0, m;
      BB_RE.lastIndex = 0;
      while ((m = BB_RE.exec(text))) {
        if (m.index > last) top().append(text.slice(last, m.index));
        last = BB_RE.lastIndex;
        const [all, close, rawTag, arg, icon, link, nameIcon, url] = m;
        if (all === "\n") { top().append(el("br")); continue; }
        if (/^-{5}/.test(all)) { top().append(el("span", "bbcode bbcode_hr")); continue; }
        if (icon) { top().append(userBits(icon, true, true)); continue; }
        if (link) { top().append(userBits(link, false)); continue; }
        if (nameIcon) { top().append(userBits(nameIcon, true)); continue; }
        if (url) {
          if (stack.some((x) => x.tag === "url" || x.tag === "yt")) { top().append(url); continue; }
          const a = el("a", null, url);
          a.href = safeUrl(url); a.target = "_blank"; a.rel = "noopener";
          top().append(a);
          continue;
        }
        const tag = rawTag.toLowerCase();
        if (!BB_TAGS[tag]) { top().append(all); continue; }
        if (close) {
          const at = stack.map((x) => x.tag).lastIndexOf(tag);
          if (at > 0) stack.length = at; else top().append(all);
          continue;
        }
        const [name, cls] = BB_TAGS[tag].split(".");
        const node = el(name, cls ? "bbcode " + cls : null);
        if (tag === "color") {
          const c = (arg || "").trim();
          if (!/^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(c)) { top().append(all); continue; }
          node.style.color = c;
        } else if (tag === "url") {
          const href = safeUrl(arg || "") || "";
          if (href) { node.href = href; node.target = "_blank"; node.rel = "noopener"; }
          else if (arg !== undefined) { top().append(all); continue; }
          else node.dataset.self = "1";           // [url]https://…[/url]: the text is the address
        } else if (tag === "yt") {
          node.className = "faw-up__yt";
          node.dataset.self = "1";
          node.append("▶ ");
        } else if (tag === "quote" && arg) {
          node.append(el("span", "bbcode_quote_name", arg.trim() + " wrote:"));
        } else if (arg !== undefined) { top().append(all); continue; }
        top().append(node);
        stack.push({ tag, node, all });
      }
      if (last < text.length) top().append(text.slice(last));
      // a tag never closed stays as typed text, its content unformatted (as FA shows it)
      while (stack.length > 1) {
        const { node, all } = stack.pop();
        if (node.firstChild && node.firstChild.className === "bbcode_quote_name") node.firstChild.remove();
        if (node.className === "faw-up__yt" && node.firstChild) node.firstChild.remove();
        node.replaceWith(all, ...node.childNodes);
      }
      // [url]…[/url] and [yt]…[/yt] link to their own text
      for (const a of root.querySelectorAll("a[data-self]")) {
        const t = a.textContent.replace(/^▶ /, "").trim();
        const href = safeUrl(a.dataset.self && /^https?:/i.test(t) ? t : (a.classList.contains("faw-up__yt") ? "https://youtu.be/" + t : ""));
        if (href) { a.href = href; a.target = "_blank"; a.rel = "noopener"; }
        delete a.dataset.self;
      }
      return root;
    }

    // ---------------------------------------------------------------- storage: IndexedDB, memory as fallback
    // "files": { id, file, thumb } for the form's files and queued uploads (same id), "jobs": the queue.
    const DB = (() => {
      const mem = { jobs: new Map(), files: new Map() };
      let dbp = null;
      const open = () => dbp || (dbp = new Promise((res) => {
        try {
          const q = indexedDB.open("faw-upload", 1);
          q.onupgradeneeded = () => {
            q.result.createObjectStore("jobs", { keyPath: "id" });
            q.result.createObjectStore("files", { keyPath: "id" });
          };
          q.onsuccess = () => res(q.result);
          q.onerror = () => res(null);
        } catch (e) { res(null); }
      }));
      const inMem = (name, method, arg) => {
        const m = mem[name];
        if (method === "getAll") return [...m.values()];
        if (method === "getAllKeys") return [...m.keys()];
        if (method === "get") return m.get(arg);
        if (method === "put") m.set(arg.id, arg); else if (method === "delete") m.delete(arg);
        return undefined;
      };
      async function op(name, method, arg) {
        const d = await open();
        if (!d) return inMem(name, method, arg);
        if (method === "get" && mem[name].has(arg)) return mem[name].get(arg);
        try {
          const out = await new Promise((res, rej) => {
            const t = d.transaction(name, /get/.test(method) ? "readonly" : "readwrite");
            const r = t.objectStore(name)[method](arg);
            t.oncomplete = () => res(r.result);
            t.onerror = t.onabort = () => rej(t.error);
          });
          if (method === "getAll") return out.concat(inMem(name, "getAll"));
          if (method === "getAllKeys") return out.concat(inMem(name, "getAllKeys"));
          if (method === "delete") mem[name].delete(arg);
          return out;
        } catch (e) {
          return inMem(name, method, arg);           // e.g. a File the browser won't store: keep it in this tab
        }
      }
      return {
        jobs: () => op("jobs", "getAll"),
        job: (id) => op("jobs", "get", id),
        putJob: (j) => op("jobs", "put", Object.assign({}, j)),
        delJob: (id) => op("jobs", "delete", id),
        files: (id) => op("files", "get", id),
        fileIds: () => op("files", "getAllKeys"),
        putFiles: (rec) => op("files", "put", rec),
        delFiles: (id) => op("files", "delete", id)
      };
    })();

    // ---------------------------------------------------------------- page
    const faForm = $("form[action*='/submit/upload']") || $("form#myform");
    if (!faForm) return;                                   // not logged in, or FA changed the page
    const faBox = faForm.closest("section") || faForm;
    const maxSize = Number((faForm.querySelector("[name=MAX_FILE_SIZE]") || {}).value) || 10485760;
    const avatar = $("img.loggedin_user_avatar");
    const me = avatar ? avatar.closest("a") : null;
    const myName = me ? (me.getAttribute("href").match(/^\/user\/([^/]+)/) || [])[1] || "" : "";
    const TAB = Math.random().toString(36).slice(2);

    const st = {
      files: [],                 // { id, file, thumb, type, title, rating, genders (null: the form's), apart, text, warn, showG }
      rating: "", cat: "1", atype: "1", species: "1", folders: [], newFolder: "",
      lock: false, scrap: false, stripGps: true,
      desc: "", keywords: [], genders: [],
      lists: null, folderList: [], usedKw: [],
      floor: 0                   // newest submission ID known: an upload FA saved has a higher one
    };
    let jobs = [];               // the queue: { id, created, title, type, rating, genders, shared, state, phase, info, link, uncertain, floor, preview, progress }
    const fileCache = new Map(); // job id → { file, thumb }

    // ---- frame: head bar, then files | text | details
    const panel = el("div", "faw-up");                     // not a <section>: FA borders every section
    const head = el("div", "faw-up__head");
    const ht = el("div", "faw-up__htext");
    ht.append(el("h2", null, T("upTitle")), el("p", "faw-up__hint", T("upSub")));
    const copyBtn = btn("faw-up__btn faw-up__btn--accent", T("upCopy"), () => openPicker());
    // switches between the two forms: FA's takes the place of ours, the head bar stays to switch back
    const classic = btn("faw-up__link", T("upClassic"), () => setClassic(!panel.classList.contains("is-classic")));
    const setClassic = (on) => {
      panel.classList.toggle("is-classic", on);
      faBox.classList.toggle("faw-up-hidden", !on);
      classic.textContent = on ? T("upHideClassic") : T("upClassic");
    };
    const resetBtn = btn("faw-up__btn", T("upReset"), () => resetForm());
    resetBtn.title = T("upResetTip");
    head.append(ht, resetBtn, copyBtn, classic);
    const copied = el("div", "faw-up__copied");
    copied.hidden = true;
    const grid = el("div", "faw-up__grid");
    const colFiles = el("div", "faw-up__col faw-up__col--files");
    const colText = el("div", "faw-up__col faw-up__col--text");
    const colMeta = el("div", "faw-up__col faw-up__col--meta");
    grid.append(colFiles, colText, colMeta);
    panel.append(head, copied, grid);
    faBox.before(panel);
    faBox.classList.add("faw-up-hidden");
    document.documentElement.classList.add("faw-up-on");   // hides FA's banner: the form gets the room

    const sec = (col, label, cls, ...kids) => {
      const s = el("div", "faw-up__sec" + (cls ? " " + cls : ""));
      if (label) s.append(el("h4", null, label));
      s.append(...kids);
      col.append(s);
      return s;
    };

    // object URLs for previews, one per file/upload id, freed when it goes
    const urls = new Map();
    const urlFor = (id, blob) => {
      const c = urls.get(id);
      if (c && c.blob === blob) return c.url;
      if (c) URL.revokeObjectURL(c.url);
      const url = URL.createObjectURL(blob);
      urls.set(id, { blob, url });
      return url;
    };
    const dropUrl = (id) => { const c = urls.get(id); if (c) { URL.revokeObjectURL(c.url); urls.delete(id); } };
    const pvImage = (blob, id) => { const im = el("img"); im.src = urlFor(id, blob); im.alt = ""; return im; };

    // ---- files: a card per file, the drop zone as the last card; files dropped anywhere on the page land here
    const drop = el("label", "faw-up__drop");
    const pick = el("input");
    pick.type = "file"; pick.multiple = true; pick.hidden = true;
    pick.accept = "image/*,.txt,.rtf,.doc,.docx,.odt,.pdf,.mp3,.wav,.mid,.midi";
    drop.append(el("span", "faw-up__dropicon", "+"), el("strong", null, T("upDrop")), el("span", null, T("upDropSub")), pick);
    const fileHead = el("div", "faw-up__colhead");
    const fileList = el("div", "faw-up__files");
    const queueBox = el("div", "faw-up__queue");
    colFiles.append(fileHead, fileList, queueBox);
    pick.addEventListener("change", () => { addFiles([...pick.files]); pick.value = ""; });
    // A file dropped anywhere on the page lands here. Capture phase: FA's own uploader script swallows
    // drops on the page before they bubble up (its form, when shown, still gets drops on its fields).
    const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")
      && !panel.classList.contains("is-classic");          // FA's form shown: its own drop handling
    let depth = 0;
    window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; colFiles.classList.add("is-over"); }, true);
    window.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, true);
    window.addEventListener("dragleave", (e) => { if (hasFiles(e) && depth && !--depth) colFiles.classList.remove("is-over"); }, true);
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation(); depth = 0; colFiles.classList.remove("is-over");
      addFiles([...e.dataTransfer.files]);
    }, true);
    document.addEventListener("paste", (e) => {
      if (e.target.closest && e.target.closest("input, textarea")) return;
      const fs = [...(e.clipboardData ? e.clipboardData.files : [])];
      if (fs.length) { e.preventDefault(); addFiles(fs); }
    });

    // animated WebP (VP8X with the animation flag): only the first frame survives the conversion
    async function animatedWebp(f) {
      try {
        const b = new Uint8Array(await f.slice(0, 21).arrayBuffer());
        const s = (a, z) => String.fromCharCode(...b.subarray(a, z));
        return s(0, 4) === "RIFF" && s(8, 12) === "WEBP" && s(12, 16) === "VP8X" && !!(b[20] & 2);
      } catch (e) { return false; }
    }
    async function addFiles(list) {
      const bad = [];
      for (const f of list) {
        const type = typeOf(f);
        if (!type) { bad.push(T("upBadType", f.name)); continue; }
        let warn = "";
        if (type === "submission" && !IMG_OK.test(f.type)) {   // to be converted: it has to be readable
          try { const b = await createImageBitmap(f); if (b.close) b.close(); } catch (e) { bad.push(T("upCantReadFile", f.name)); continue; }
          if (await animatedWebp(f)) warn = T("upAnimated");
        }
        if (type !== "submission" && f.size > maxSize) { bad.push(T("upTooLarge", mb(maxSize), f.name)); continue; }
        const it = { id: Math.random().toString(36).slice(2), file: f, thumb: null, type, title: titleFrom(f.name || "image"),
          rating: "", genders: null, apart: false, text: type === "story", warn };
        st.files.push(it);
        DB.putFiles({ id: it.id, file: f, thumb: null }).catch(() => {});
      }
      if (bad.length) note(bad.join(" · "), true);
      renderFiles(); saveDraft();
    }
    function removeFile(it) {
      dropUrl(it.id);
      st.files = st.files.filter((x) => x !== it);
      DB.delFiles(it.id).catch(() => {});
      renderFiles(); saveDraft();
    }
    const genderLabel = (it) => (!it.genders ? T("upGendersForm") : it.genders.length
      ? T("upGendersOwn", it.genders.map((g) => g.replace("_", " ")).join(", ")) : T("upGendersNone"));
    function renderFiles() {
      fileList.replaceChildren();
      fileList.classList.toggle("is-empty", !st.files.length);
      fileList.classList.toggle("is-single", st.files.length === 1);   // one file: a large preview
      const many = st.files.length > 1;
      for (const it of st.files) {
        const card = el("div", "faw-up__card" + (it.apart ? " is-apart" : ""));
        const pv = el("div", "faw-up__pv");
        if (it.type === "submission") pv.append(pvImage(it.file, it.id));
        else if (it.thumb) pv.append(pvImage(it.thumb, it.id));
        else pv.append(el("span", "faw-up__pvtype", it.type === "music" ? "♪" : "¶"));
        const rm = btn("faw-up__x", "×", () => removeFile(it));
        rm.title = T("upRemove");
        pv.append(rm, el("span", "faw-up__size", mb(it.file.size) + " MB"));
        if (it.apart) pv.append(el("span", "faw-up__badge", T("upApartBadge")));
        const title = el("input", "faw-up__in faw-up__ctitle");
        title.maxLength = 60; title.value = it.title; title.placeholder = T("upTitleField"); title.title = it.file.name;
        title.addEventListener("input", () => { it.title = title.value; saveDraft(); });
        const meta = el("div", "faw-up__fmeta");
        const rs = el("select", "faw-up__sel");           // own rating for this file, or the form's
        rs.title = T("upRating");
        rs.append(new Option(T("upRatingForm"), ""));
        for (const [v, n] of RATINGS) rs.append(new Option(n, v));
        rs.value = it.rating;
        rs.addEventListener("change", () => { it.rating = rs.value; saveDraft(); });
        meta.append(rs);
        if (it.text) {                                     // story or poem: FA asks which
          const ts = el("select", "faw-up__sel");
          ts.append(new Option(T("upStory"), "story"), new Option(T("upPoetry"), "poetry"));
          ts.value = it.type;
          ts.addEventListener("change", () => { it.type = ts.value; saveDraft(); });
          meta.append(ts);
        }
        if (it.type !== "submission") {                    // stories and music can get a cover
          const cv = el("label", "faw-up__link", it.thumb ? T("upCoverSet", it.thumb.name) : T("upCover"));
          const ci = el("input"); ci.type = "file"; ci.accept = "image/*"; ci.hidden = true;
          ci.addEventListener("change", () => {
            it.thumb = ci.files[0] || null;
            DB.putFiles({ id: it.id, file: it.file, thumb: it.thumb }).catch(() => {});
            renderFiles();
          });
          cv.append(ci);
          meta.append(cv);
        }
        const gb = btn("faw-up__link faw-up__glink", genderLabel(it), () => { it.showG = !it.showG; renderFiles(); });
        meta.append(gb);
        card.append(pv, title, meta);
        if (it.showG) {                                    // own gender keywords for this file, or the form's
          const row = el("div", "faw-up__chips faw-up__cgenders");
          row.append(btn("faw-up__gchip" + (it.genders ? "" : " is-on"), T("upFormGenders"), () => { it.genders = null; renderFiles(); saveDraft(); }));
          for (const g of GENDERS) {
            row.append(btn("faw-up__gchip" + (it.genders && it.genders.includes(g) ? " is-on" : ""), g.replace("_", " "), () => {
              const cur = it.genders || st.genders.slice();  // starts from the form's choice
              it.genders = cur.includes(g) ? cur.filter((q) => q !== g) : cur.concat(g);
              renderFiles(); saveDraft();
            }));
          }
          card.append(row);
        }
        if (many) {                                        // its own description and keywords, in a form of its own
          const ap = el("label", "faw-up__check faw-up__apart");
          const apc = el("input"); apc.type = "checkbox"; apc.checked = it.apart;
          apc.addEventListener("change", () => { it.apart = apc.checked; renderFiles(); saveDraft(); });
          ap.append(apc, " " + T("upApart"));
          ap.title = T("upApartTip");
          card.append(ap);
        }
        if (it.warn) card.append(el("div", "faw-up__warn", it.warn));
        fileList.append(card);
      }
      fileList.append(drop);
      fileHead.replaceChildren(el("h4", null, T("upFiles") + (st.files.length ? " · " + st.files.length : "")));
      if (st.files.length) fileHead.append(btn("faw-up__link faw-up__clearfiles", T("upClearFiles"), () => {
        if (st.files.length > 1 && !confirm(T("upClearFilesAsk", st.files.length))) return;
        for (const f of st.files) { dropUrl(f.id); DB.delFiles(f.id).catch(() => {}); }
        st.files = [];
        renderFiles(); saveDraft();
      }));
      if (many) fileHead.append(el("span", "faw-up__hint", T("upMany")));
    }

    // ---- text column: rating, description, keywords
    const ratingRow = el("div", "faw-up__seg");
    const ratingBtns = RATINGS.map(([v, n]) => {
      const b = btn("faw-up__segbtn r-" + n.toLowerCase(), n, () => { st.rating = v; syncRating(); savePrefs(); });
      ratingRow.append(b);
      return [v, b];
    });
    const syncRating = () => { for (const [v, b] of ratingBtns) b.classList.toggle("is-on", st.rating === v); };
    sec(colText, T("upRating"), "", ratingRow);

    const bb = el("div", "faw-up__bb");
    const desc = el("textarea", "faw-up__in faw-up__desc");
    desc.maxLength = 65000; desc.placeholder = T("upDescField");
    for (const [label, open, close, tip] of [["B", "[b]", "[/b]"], ["I", "[i]", "[/i]"], ["U", "[u]", "[/u]"], ["S", "[s]", "[/s]"],
      ["⇔", "[center]", "[/center]", "center"], ["❝", "[quote]", "[/quote]", "quote"], ["🔗", "[url=]", "[/url]", "url"],
      [":icon:", ":icon", ":", ":iconname:"], [":link:", ":link", ":", ":linkname:"]]) {
      const b = btn("faw-up__bbbtn", label, () => {
        const a = desc.selectionStart, z = desc.selectionEnd, v = desc.value;
        desc.value = v.slice(0, a) + open + v.slice(a, z) + close + v.slice(z);
        desc.focus();
        desc.selectionStart = desc.selectionEnd = z + open.length + (z === a ? 0 : close.length);
        st.desc = desc.value; saveDraft();
      });
      if (tip) b.title = tip;
      bb.append(b);
    }
    // live preview below the text, rendered the way FA shows BBCode (FA's own bbcode classes)
    const preview = el("div", "faw-up__preview");
    let pvTimer = null;
    const renderPreview = () => {
      clearTimeout(pvTimer);
      pvTimer = null;
      const out = bbcode(desc.value);
      preview.replaceChildren(...(out.childNodes.length ? [out] : [el("span", "faw-up__hint", T("upPreviewEmpty"))]));
    };
    const queuePreview = () => { if (!pvTimer) pvTimer = setTimeout(renderPreview, 120); };
    desc.addEventListener("input", () => { st.desc = desc.value; saveDraft(); queuePreview(); });
    for (const b of bb.children) b.addEventListener("click", queuePreview);
    sec(colText, T("upDesc"), "faw-up__sec--grow faw-up__sec--desc", bb, desc, el("h5", null, T("upPreview")), preview);
    renderPreview();

    // keywords as chips; a space, comma or Enter turns the typed text into a chip
    const kwBox = el("div", "faw-up__kw");
    const kwIn = el("input", "faw-up__kwin");
    kwIn.placeholder = T("upKwField");
    kwIn.setAttribute("list", "faw-up-kwlist");
    const kwList = el("datalist"); kwList.id = "faw-up-kwlist";
    const kwInfo = el("div", "faw-up__hint");
    const genderRow = el("div", "faw-up__chips");
    sec(colText, T("upKeywords"), "", genderRow, kwBox, kwInfo, kwList);
    const kwText = () => [...st.genders, ...st.keywords].join(" ");
    function addKw(raw, quiet) {
      for (const part of String(raw).split(/[\s,;]+/)) {
        const k = cleanKw(part);
        if (k.length < 3 || st.keywords.includes(k) || st.genders.includes(k)) continue;
        if (GENDERS.includes(k)) { st.genders.push(k); continue; }
        if ((kwText() + " " + k).trim().length > KW_MAX) { if (!quiet) note(T("upKwFull"), true); break; }
        st.keywords.push(k);
      }
      renderKw(); saveDraft();
    }
    kwIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); addKw(kwIn.value); kwIn.value = ""; }
      else if (e.key === "Backspace" && !kwIn.value && (st.keywords.length || st.genders.length)) {
        if (st.keywords.length) st.keywords.pop(); else st.genders.pop();
        renderKw(); saveDraft();
      }
    });
    kwIn.addEventListener("input", (e) => {
      const v = kwIn.value;
      if (/[\s,;]/.test(v)) {                          // phone keyboards don't report space or comma as keys
        const parts = v.split(/[\s,;]+/);
        const rest = /[\s,;]$/.test(v) ? "" : parts.pop();
        addKw(parts.join(" ")); kwIn.value = rest;
      } else if ((!e.inputType || e.inputType === "insertReplacementText") && st.usedKw.includes(cleanKw(v))) {
        addKw(v); kwIn.value = "";                      // picked from the suggestions
      }
    });
    kwIn.addEventListener("blur", () => { if (kwIn.value.trim()) { addKw(kwIn.value); kwIn.value = ""; } });
    kwIn.addEventListener("paste", (e) => { e.preventDefault(); addKw(e.clipboardData.getData("text")); });
    kwBox.addEventListener("click", (e) => { if (e.target === kwBox) kwIn.focus(); });
    function renderKw() {
      for (const c of [...kwBox.children]) if (c !== kwIn) c.remove();   // the input stays, keeping focus
      if (!kwIn.parentNode) kwBox.append(kwIn);
      for (const g of st.genders) {                      // gender keywords lead the list, as FA gets them
        const c = el("span", "faw-up__chip is-gender", g.replace("_", " "));
        c.title = T("upGenders");
        c.append(btn(null, "×", () => { st.genders = st.genders.filter((q) => q !== g); renderKw(); saveDraft(); if (st.files.some((f) => f.showG && !f.genders)) renderFiles(); }));
        kwBox.insertBefore(c, kwIn);
      }
      for (const k of st.keywords) {
        const c = el("span", "faw-up__chip", k);
        c.append(btn(null, "×", () => { st.keywords = st.keywords.filter((q) => q !== k); renderKw(); saveDraft(); }));
        kwBox.insertBefore(c, kwIn);
      }
      genderRow.replaceChildren(el("span", "faw-up__hint", T("upGenders")));
      for (const g of GENDERS) {
        genderRow.append(btn("faw-up__gchip" + (st.genders.includes(g) ? " is-on" : ""), g.replace("_", " "), () => {
          st.genders = st.genders.includes(g) ? st.genders.filter((q) => q !== g) : st.genders.concat(g);
          renderKw(); saveDraft();
          if (st.files.some((f) => f.showG && !f.genders)) renderFiles();
        }));
      }
      const n = st.genders.length + st.keywords.length;
      kwInfo.textContent = T("upKwCount", n, kwText().length, KW_MAX);
      kwInfo.classList.toggle("is-bad", n < 3);
    }
    const addSuggestions = (list) => {
      const have = new Set([...kwList.options].map((o) => o.value));
      for (const k of list) if (!have.has(k)) kwList.append(new Option(k));
    };

    // ---- details column: category / theme / species, folders, options, Upload
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
    sec(colMeta, T("upCatSpecies"), "", selRow);
    function fillSel(s, html, value) {
      s.replaceChildren();
      if (!html) { s.append(new Option("—", value || "1")); return; }
      const tmp = parse("<select>" + html + "</select>").querySelector("select");
      for (const n of [...tmp.children]) s.append(document.importNode(n, true));
      s.value = value;
      if (s.value !== value) s.selectedIndex = 0;
    }
    const setSel = (s, key, v) => { s.value = v; if (s.value === v) st[key] = v; };
    const syncSels = () => { setSel(catSel, "cat", st.cat); setSel(themeSel, "atype", st.atype); setSel(specSel, "species", st.species); };
    const selLabel = (s, v) => { const o = [...s.options].find((x) => x.value === v); return o ? o.textContent.trim() : ""; };

    // folders: read from your gallery page, then as FA's details page lists them; a new one can always be named
    const folderBox = el("div", "faw-up__folders");
    const newFolder = el("input", "faw-up__in");
    newFolder.placeholder = T("upNewFolder"); newFolder.maxLength = 60;
    newFolder.addEventListener("input", () => { st.newFolder = newFolder.value; });
    sec(colMeta, T("upFolders"), "faw-up__sec--grow", folderBox, newFolder);
    function renderFolders() {
      folderBox.replaceChildren();
      if (!st.folderList.length) { folderBox.append(el("p", "faw-up__hint", T("upFoldersLater"))); return; }
      // groups first, the folders in none last (under their own heading, or they'd look like the last group's)
      const list = st.folderList.filter((f) => f.g).concat(st.folderList.filter((f) => !f.g));
      const grouped = list.some((f) => f.g);
      let group = null;
      for (const f of list) {
        if (f.g !== group) { group = f.g; if (group || grouped) folderBox.append(el("h5", null, group || T("upUngrouped"))); }
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

    const opts = el("div", "faw-up__opts");
    const check = (key, label) => {
      const l = el("label", "faw-up__check");
      const c = el("input"); c.type = "checkbox";
      c.addEventListener("change", () => { st[key] = c.checked; savePrefs(); });
      l.append(c, " " + label);
      opts.append(l);
      return c;
    };
    const lockC = check("lock", T("upLock")), scrapC = check("scrap", T("upScrap")), gpsC = check("stripGps", T("upGps"));
    sec(colMeta, T("upOptions"), "", opts);

    const foot = el("div", "faw-up__foot");
    const msg = el("div", "faw-up__msg");
    const go = btn("faw-up__go", T("upSend"), send);
    foot.append(msg, go);
    colMeta.append(foot);
    function note(text, bad) { msg.textContent = text; msg.classList.toggle("is-bad", !!bad); }
    const syncChecks = () => { lockC.checked = st.lock; scrapC.checked = st.scrap; gpsC.checked = st.stripGps; };

    // ---------------------------------------------------------------- Upload: the form's files into the queue
    // Files set apart stay behind; the form then starts fresh (description, keywords) for the next of them.
    function send() {
      if (!st.files.length) { note(T("upNeedFile"), true); return; }
      let batch = st.files.filter((f) => !f.apart);
      if (!batch.length) batch = [st.files[0]];
      const problems = [];
      if (!st.rating && batch.some((f) => !f.rating)) problems.push(T("upNeedRating"));
      if (!st.desc.trim()) problems.push(T("upNeedDesc"));
      if (batch.some((f) => (f.genders || st.genders).length + st.keywords.length < 3)) problems.push(T("upNeedKw"));
      for (const f of batch) if ([...(f.genders || st.genders), ...st.keywords].join(" ").length > KW_MAX) problems.push(T("upKwFileFull", f.title));
      for (const f of batch) if (!f.title.trim()) f.title = titleFrom(f.file.name || "image");
      if (problems.length) { note(problems.join(" · "), true); return; }
      // everything but the files is shared: a snapshot per batch, so the form can be reused right away
      const shared = { cat: st.cat, atype: st.atype, species: st.species,
        catLabel: selLabel(catSel, st.cat), atypeLabel: selLabel(themeSel, st.atype), speciesLabel: selLabel(specSel, st.species),
        folders: st.folders.slice(), newFolder: st.newFolder.trim(),
        lock: st.lock, scrap: st.scrap, stripGps: st.stripGps, desc: st.desc, keywords: st.keywords.slice() };
      const now = Date.now();
      batch.forEach((f, i) => {
        const job = { id: f.id, created: now + i, title: f.title.trim().slice(0, 60), type: f.type, rating: f.rating || st.rating,
          genders: (f.genders || st.genders).slice(), text: f.text, warn: f.warn, shared, state: "wait", phase: "", info: "",
          link: "", uncertain: false, floor: st.floor, preview: null, progress: 0 };
        jobs.push(job);
        fileCache.set(f.id, { file: f.file, thumb: f.thumb });
        DB.putFiles({ id: f.id, file: f.file, thumb: f.thumb }).catch(() => {});
        DB.putJob(job).catch(() => {});
      });
      st.usedKw = [...new Set([...st.keywords, ...st.usedKw])].slice(0, 300);
      addSuggestions(st.keywords);
      keep({ uploadKeywords: st.usedKw });
      const rest = st.files.filter((f) => !batch.includes(f));
      st.files = rest; st.newFolder = ""; newFolder.value = "";
      if (rest.length) {
        if (!rest.some((f) => !f.apart)) rest[0].apart = false;
        st.desc = ""; desc.value = ""; queuePreview(); st.keywords = []; st.genders = [];
        renderKw();
        note(T("upNextApart", rest.length));
      } else note(T("upQueued"));
      saveDraft(); renderFiles(); renderQueue(); ping();
      runQueue();
    }

    // empties every field but keeps the files (and their titles): back to a fresh form
    function resetForm() {
      const filled = st.desc.trim() || st.keywords.length || st.genders.length || st.rating || st.folders.length;
      if (filled && !confirm(T("upResetAsk"))) return;
      Object.assign(st, { rating: "", cat: "1", atype: "1", species: "1", folders: [], newFolder: "",
        lock: false, scrap: false, stripGps: true, desc: "", keywords: [], genders: [] });
      for (const f of st.files) { f.rating = ""; f.genders = null; }
      newFolder.value = ""; desc.value = ""; queuePreview();
      copied.hidden = true;
      syncSels(); syncRating(); syncChecks(); renderKw(); renderFolders(); renderFiles();
      savePrefs(); saveDraft();
      note(T("upResetDone"));
    }

    // ---------------------------------------------------------------- the queue list
    let otherTab = false;        // another FA tab is sending
    const thumbFor = (q) => {
      const rec = fileCache.get(q.id) || {};
      return q.preview || (q.type === "submission" ? rec.file : rec.thumb) || null;
    };
    function renderQueue() {
      queueBox.replaceChildren();
      if (!jobs.length) return;
      const top = el("div", "faw-up__qhead");
      top.append(el("h4", null, T("upQueue")));
      if (jobs.some((q) => q.state === "done")) top.append(btn("faw-up__link", T("upClear"), clearFinished));
      queueBox.append(top);
      for (const q of jobs) {
        const row = el("div", "faw-up__qrow is-" + q.state);
        const th = el("span", "faw-up__qthumb");
        const pic = thumbFor(q);
        if (pic) th.append(pvImage(pic, q.id)); else th.textContent = q.type === "music" ? "♪" : "¶";
        row.append(th, el("span", "faw-up__qtitle", q.title));
        const info = el("span", "faw-up__qinfo");
        if (q.state === "done") {
          const a = el("a", null, T("upDone")); a.href = q.link; a.target = "_blank"; info.append(a);
        } else info.textContent = q.info || T("upWaiting");
        row.append(info);
        const acts = el("span", "faw-up__qacts");
        if (q.state === "fail") acts.append(btn("faw-up__link", T("retry"), () => retryJob(q)));
        if (q.state === "fail" || q.state === "wait") {
          acts.append(btn("faw-up__link", T("upEdit"), () => editJob(q)));
          const x = btn("faw-up__qx", "×", () => removeJob(q)); x.title = T("upRemove"); acts.append(x);
        }
        if (acts.childNodes.length) row.append(acts);
        if (q.state === "busy" && q.phase === "upload" && q.progress > 0) row.style.setProperty("--p", Math.round(q.progress * 100) + "%");
        queueBox.append(row);
      }
      const waiting = jobs.some((q) => q.state === "wait" || q.state === "busy");
      if (waiting) queueBox.append(el("p", "faw-up__hint", otherTab && !running ? T("upOtherTab") : T("upKeepOpen")));
    }
    // the other FA tabs re-read the queue when it changes
    const ping = () => keep({ uploadPing: TAB + ":" + Date.now() });
    const saveJob = (q) => DB.putJob(q).catch(() => {});
    async function removeJob(q, quiet) {
      jobs = jobs.filter((j) => j.id !== q.id);
      fileCache.delete(q.id); dropUrl(q.id);
      await DB.delJob(q.id).catch(() => {});
      DB.delFiles(q.id).catch(() => {});
      if (!quiet) { renderQueue(); ping(); }
    }
    function clearFinished() {
      for (const q of jobs.filter((j) => j.state === "done")) removeJob(q, true);
      renderQueue(); ping();
    }
    function retryJob(q) {
      Object.assign(q, { state: "wait", info: "", progress: 0 });
      saveJob(q).then(() => { renderQueue(); ping(); runQueue(); });
    }
    // back into the form, to change what FA didn't like (an empty form takes the upload's details too)
    async function editJob(q) {
      const rec = fileCache.get(q.id) || await DB.files(q.id).catch(() => null);
      if (!rec || !rec.file) { note(T("upGone"), true); return; }
      const it = { id: q.id, file: rec.file, thumb: rec.thumb || null, type: q.type, title: q.title, rating: q.rating,
        genders: q.genders.slice(), apart: false, text: q.text, warn: q.warn || "" };
      if (!st.files.length) {
        const s = q.shared;
        Object.assign(st, { rating: q.rating, cat: s.cat, atype: s.atype, species: s.species, folders: s.folders.slice(),
          lock: s.lock, scrap: s.scrap, stripGps: s.stripGps, desc: s.desc, keywords: s.keywords.slice(), genders: q.genders.slice(),
          newFolder: s.newFolder || "" });
        it.rating = ""; it.genders = null;
        newFolder.value = st.newFolder; desc.value = st.desc; queuePreview();
        syncSels(); syncRating(); syncChecks(); renderKw(); renderFolders(); savePrefs();
      }
      jobs = jobs.filter((j) => j.id !== q.id);
      fileCache.delete(q.id);
      await DB.delJob(q.id).catch(() => {});
      DB.putFiles({ id: it.id, file: it.file, thumb: it.thumb }).catch(() => {});
      st.files.push(it);
      saveDraft(); renderFiles(); renderQueue(); ping();
    }
    async function reloadJobs() {
      const fromDb = await DB.jobs().catch(() => null);
      if (!fromDb) return;
      const byId = new Map(jobs.map((j) => [j.id, j]));
      jobs = fromDb.map((d) => (active && d.id === active.id ? active : Object.assign(byId.get(d.id) || {}, d)))
        .sort((a, b) => a.created - b.created);
      for (const id of byId.keys()) if (!jobs.some((j) => j.id === id)) { fileCache.delete(id); dropUrl(id); }
      await loadFiles();
      renderQueue();
    }
    async function loadFiles() {
      for (const q of jobs) {
        if (q.state === "done" || fileCache.has(q.id)) continue;
        const rec = await DB.files(q.id).catch(() => null);
        if (rec) fileCache.set(q.id, { file: rec.file, thumb: rec.thumb || null });
      }
    }

    // ---------------------------------------------------------------- sending, one FA tab at a time
    let running = false, active = null, heartbeat = null;
    const REMOVED = new Error("removed");
    async function claim() {
      const { uploadRunner: r } = await store({ uploadRunner: null });
      if (r && r.tab !== TAB && Date.now() - r.at < 20000) return false;
      await keepNow({ uploadRunner: { tab: TAB, at: Date.now() } });
      await sleep(300 + Math.random() * 300);                 // two tabs at once: the last write wins
      const { uploadRunner: r2 } = await store({ uploadRunner: null });
      return !!r2 && r2.tab === TAB;
    }
    async function release() {
      const { uploadRunner: r } = await store({ uploadRunner: null });
      if (r && r.tab === TAB) try { chrome.storage.local.remove("uploadRunner"); } catch (e) { /* reloaded */ }
    }
    // an upload still "busy" while no tab sends was cut off (tab closed, reloaded, crashed): one whose details
    // went out may be on FA already (marked, and its Retry looks in the gallery first), any other goes again
    const orphaned = () => jobs.filter((q) => q.state === "busy" && q !== active);
    function recover() {
      for (const q of orphaned()) {
        if (q.phase === "finalize") { q.uncertain = true; failJob(q, T("upInterrupted")); } else Object.assign(q, { state: "wait", info: "", phase: "", progress: 0 });
        saveJob(q);
      }
    }
    async function runQueue() {
      if (running || !(jobs.some((q) => q.state === "wait") || orphaned().length)) return;
      running = true;
      try {
        if (!(await claim())) { otherTab = true; return; }
        otherTab = false;
        heartbeat = setInterval(() => keep({ uploadRunner: { tab: TAB, at: Date.now() } }), 5000);
        await reloadJobs();
        recover();
        for (;;) {
          await reloadJobs();                                  // other tabs may have added, changed or removed some
          const q = jobs.find((x) => x.state === "wait");
          if (!q) break;
          active = q;
          try {
            // FA's flood protection: keep a pause after the previous upload, with a countdown
            const { uploadLastAt: last } = await store({ uploadLastAt: 0 });
            const left = Math.ceil((GAP_MS - (Date.now() - last)) / 1000);
            if (left > 0 && left <= GAP_MS / 1000) await countdown(q, left, "upPause");
            await sendOne(q);
          } catch (err) {
            if (err !== REMOVED) failJob(q, err.message);
          }
          active = null;
          if (jobs.includes(q)) await saveJob(q);
          renderQueue(); ping();
        }
      } finally {
        running = false; active = null;
        clearInterval(heartbeat);
        await release();
        renderQueue();
      }
    }
    // a pause with its countdown on the upload; stops when the upload was removed or taken back meanwhile
    async function countdown(q, secs, key) {
      for (let s = secs; s > 0; s--) {
        q.info = T(key, s); renderQueue();
        await sleep(1000);
        if (!jobs.includes(q) || !(await DB.job(q.id).catch(() => q))) throw REMOVED;
      }
    }
    function failJob(q, why) {
      Object.assign(q, { state: "fail", phase: "", progress: 0, info: T("upFailed", why) + (q.uncertain ? " – " + T("upMaybe") : "") });
    }
    async function finish(q, id) {
      const rec = fileCache.get(q.id) || {};
      const pic = q.type === "submission" ? rec.file : rec.thumb;
      q.preview = pic ? await smallPreview(pic).catch(() => null) : null;
      Object.assign(q, { state: "done", phase: "", info: "", progress: 0, uncertain: false, link: "/view/" + id + "/" });
      fileCache.delete(q.id);
      DB.delFiles(q.id).catch(() => {});
      st.floor = Math.max(st.floor, id);
      keep({ uploadFloor: st.floor });
      const done = jobs.filter((j) => j.state === "done");
      for (const j of done.slice(0, Math.max(0, done.length - KEEP_DONE))) removeJob(j, true);
    }

    // FA's reasons: a system message box, its bare "System Error" page, or an error above a form
    function faMessage(doc) {
      const box = doc.querySelector("section.notice-message .section-body");
      let n = box ? (box.querySelector(".redirect-message") || box.querySelector("p") || box) : null;
      if (!n) {
        const s = [...doc.querySelectorAll("section")].find((x) => /system error/i.test((x.querySelector(".section-header h2") || {}).textContent || ""));
        const body = s && s.querySelector(".section-body");
        if (body) { n = body.cloneNode(true); for (const b of n.querySelectorAll(".alignright, .button, a.button")) b.remove(); }
      }
      if (!n) n = doc.querySelector(".redirect-message, .error-message, .notice-message");
      return n ? n.textContent.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    }
    const pageError = (doc) => faMessage(doc) || (doc.title || "").trim().slice(0, 120);
    const loggedOut = (doc) => !doc.querySelector("img.loggedin_user_avatar") && !!doc.querySelector("a[href*='/login']");
    // "Flood protection. Please wait 16 seconds before trying again." → 16
    const floodSeconds = (text) => (/flood/i.test(text || "") ? Number(((text.match(/wait\s+(\d+)\s*sec/i) || [])[1]) || 30) : null);
    const finalizeForm = (doc) => doc.querySelector("form[action*='finalize']")
      || [...doc.forms].find((f) => f.getAttribute("action") && f.querySelector("input[name=title], textarea[name=title]"));
    // FA takes .mid, not .midi
    const musicFile = (f) => (/\.midi$/i.test(f.name) ? new File([f], f.name.replace(/\.midi$/i, ".mid"), { type: f.type }) : f);

    // Did FA save it after all? A submission in your gallery (or scraps) with this title and an ID above
    // the newest one known when it was queued.
    async function findUploaded(q) {
      if (!myName) return 0;
      const { doc } = await getDoc(`/${q.shared.scrap ? "scraps" : "gallery"}/${myName}/`);
      for (const f of doc.querySelectorAll("section.gallery figure")) {
        const id = Number((f.id.match(/\d+/) || [])[0]) || 0, t = f.querySelector("figcaption a[title]");
        if (id > (q.floor || 0) && t && t.getAttribute("title").trim() === q.title.trim()) return id;
      }
      return 0;
    }

    async function sendOne(q) {
      const rec = fileCache.get(q.id) || await DB.files(q.id).catch(() => null);
      if (!rec || !rec.file) { failJob(q, T("upGone")); return; }
      fileCache.set(q.id, { file: rec.file, thumb: rec.thumb || null });
      Object.assign(q, { state: "busy", info: "", progress: 0 });
      await saveJob(q); ping();
      if (q.uncertain) {                                   // the last try may have reached FA: look first
        q.info = T("upChecking"); renderQueue();
        const id = await findUploaded(q).catch(() => 0);
        if (id) { await finish(q, id); return; }
        q.uncertain = false;
      }
      let floods = 0, nets = 0;
      for (;;) {
        q.phase = "upload"; q.progress = 0;
        try {
          q.info = T("upPreparing"); renderQueue();
          const file = q.type === "submission" ? await fitImage(rec.file, q.shared.stripGps) : musicFile(rec.file);
          const thumb = rec.thumb ? await fitImage(rec.thumb, true) : null;
          // 1) fresh upload form (its key)
          const { doc } = await getDoc("/submit/");
          const f1 = doc.querySelector("form[action*='/submit/upload']") || doc.querySelector("form#myform");
          if (!f1) throw new Error(loggedOut(doc) ? T("upLoggedOut") : pageError(doc) || T("upNoForm"));
          const kinds = [...f1.querySelectorAll("input[name=submission_type]")].map((r) => r.value);
          if (kinds.length && !kinds.includes(q.type)) throw new Error(T("upKindNo"));
          const fd = newForm();
          for (const i of f1.querySelectorAll("input[type=hidden][name]")) fd.append(i.name, i.value);
          fd.append("submission_type", q.type);
          const fileInputs = [...f1.querySelectorAll("input[type=file][name]")];
          fd.append((fileInputs[0] && fileInputs[0].name) || "submission", file, file.name);
          if (thumb) fd.append((fileInputs[1] && fileInputs[1].name) || "thumbnail", thumb, thumb.name);
          const size = mb(file.size + (thumb ? thumb.size : 0));
          q.info = T("upSending", size, 0); renderQueue();
          const r1 = await postFile(new URL(f1.getAttribute("action") || "/submit/upload/", location.origin).href, fd, (p) => {
            const pct = Math.round(p * 100);
            if (pct === Math.round(q.progress * 100)) return;
            q.progress = p; q.info = T("upSending", size, pct); renderQueue();
          });
          keep({ uploadLastAt: Date.now() });
          // 2) details form
          const f2 = finalizeForm(r1.doc);
          if (!f2) {
            const id = viewId(r1.url);
            if (id) { await finish(q, id); return; }
            throw new Error(pageError(r1.doc) || T("upNoFinalize"));
          }
          rememberLists(f2);
          Object.assign(q, { phase: "finalize", progress: 1, info: T("upFinishing") });
          await saveJob(q); renderQueue();
          const action = new URL(f2.getAttribute("action"), location.origin).href;
          let r2;
          for (let w = 0; ; w++) {                         // flood protection here: the same details again after the wait
            r2 = await getDoc(action, { method: "POST", body: finalizeData(f2, q) });
            keep({ uploadLastAt: Date.now() });
            if (viewId(r2.url)) break;
            const secs = floodSeconds(faMessage(r2.doc));
            if (secs == null || w >= 3) break;
            await countdown(q, secs + 2, "upPause");
            q.info = T("upFinishing"); renderQueue();
          }
          const id = viewId(r2.url);
          if (id) { await finish(q, id); return; }
          // no submission to go to: look in the gallery anyway, then FA's reason (or its form again) means
          // nothing was saved; any other answer stays a "maybe"
          q.info = T("upChecking"); renderQueue();
          await sleep(4000);
          const found = await findUploaded(q).catch(() => 0);
          if (found) { await finish(q, found); return; }
          const why = faMessage(r2.doc);
          if (why || finalizeForm(r2.doc)) { failJob(q, why || T("upRefused")); return; }
          q.uncertain = true;
          failJob(q, T("upUnknown"));
          return;
        } catch (err) {
          if (err === REMOVED) throw err;
          if (q.phase === "finalize") {                    // the details may have reached FA: look before saying anything
            q.info = T("upChecking"); renderQueue();
            await sleep(4000);
            const id = await findUploaded(q).catch(() => 0);
            if (id) { await finish(q, id); return; }
            q.uncertain = true;
            failJob(q, err.message);
            return;
          }
          const secs = floodSeconds(err.message);          // nothing kept by FA yet: safe to start over
          if (secs != null && floods++ < 3) { await countdown(q, secs + 2, "upPause"); continue; }
          if (err.net && nets++ < 3) { await countdown(q, 10, "upNetRetry"); continue; }
          failJob(q, err.message);
          return;
        }
      }
    }

    // FA's details form as a browser would send it: every field with FA's default, our choices on top
    // (lists by value and label, the rating by its label), so a field FA adds later keeps its default.
    function finalizeData(form, q) {
      const s = q.shared, fd = newForm();
      const ratingName = (RATINGS.find(([v]) => v === q.rating) || [])[1] || "";
      const ratingRadio = [...form.querySelectorAll("input[type=radio][name=rating]")]
        .find((r) => { const l = r.closest("label") || form.querySelector(`label[for="${r.id}"]`); return l && ratingName && l.textContent.trim().startsWith(ratingName); });
      const ratingValue = ratingRadio ? ratingRadio.value : q.rating;
      const want = { cat: [s.cat, s.catLabel], atype: [s.atype, s.atypeLabel], species: [s.species, s.speciesLabel] };
      const keywords = [...q.genders, ...s.keywords].join(" ");
      let submit = false, rating = false;
      for (const c of form.querySelectorAll("input[name], textarea[name], select[name], button[name]")) {
        const n = c.name, type = (c.getAttribute("type") || "").toLowerCase();
        if (c.disabled) continue;
        if (c.tagName === "SELECT") {
          const o = [...c.options], w = want[n];
          const hit = w && (o.find((x) => x.value === w[0] && x.textContent.trim() === w[1]) || o.find((x) => w[1] && x.textContent.trim() === w[1]) || o.find((x) => x.value === w[0]));
          const pickd = hit || c.selectedOptions[0] || o[0];
          if (pickd) fd.append(n, pickd.value);
          if (n === "rating" && hit === undefined) { fd.set(n, ratingValue); rating = true; }
        } else if (c.tagName === "TEXTAREA") {
          fd.append(n, n === "message" ? s.desc : n === "keywords" ? keywords : c.value);
        } else if (c.tagName === "BUTTON" || type === "submit") {
          if (!submit && (c.tagName !== "BUTTON" || !type || type === "submit")) { fd.append(n, c.value || c.textContent.trim()); submit = true; }
        } else if (type === "radio") {
          if (n === "rating") { if (c.value === ratingValue) { fd.append(n, c.value); rating = true; } }
          else if (c.checked) fd.append(n, c.value);
        } else if (type === "checkbox") {
          const on = /scrap/.test(n) ? s.scrap : /lock_comment|disable_comment/.test(n) ? s.lock
            : /^folder/.test(n) ? s.folders.includes(c.value) : c.checked;
          if (on) fd.append(n, c.value || "on");
        } else if (!["file", "button", "reset", "image"].includes(type)) {
          fd.append(n, n === "title" ? q.title.trim().slice(0, 60) : n === "create_folder_name" ? s.newFolder : c.value);
        }
      }
      if (!rating) fd.append("rating", ratingValue);
      return fd;
    }

    // lists and folders as FA's details (or edit) page has them, kept for the next upload
    function rememberLists(form) {
      const html = (n) => { const s = form.querySelector(`select[name="${n}"]`); return s ? s.innerHTML : ""; };
      const lists = { cat: html("cat"), atype: html("atype"), species: html("species") };
      const folders = [];
      for (const c of form.querySelectorAll("input[name='folder_ids[]']")) {
        const l = form.querySelector(`label[for="${c.id}"]`);
        let g = "", p = c.closest(".folder_name") || c;
        while ((p = p.previousElementSibling)) if (/^H\d$/.test(p.tagName)) { g = p.textContent.trim(); break; }
        if (/^folders not in/i.test(g)) g = "";            // FA's heading for the folders in no group
        folders.push({ v: c.value, n: (l ? l.textContent : c.value).trim(), g });
      }
      if (lists.cat) { st.lists = lists; keep({ uploadLists: lists }); }
      st.folderList = folders;
      keep({ uploadFolders: folders });
      renderFolders();
    }
    // your folders from your gallery page (each under the group heading above it; FA lists the folders
    // in no group last, in a "default-group" list without a heading), and the newest submission ID
    async function loadGallery() {
      if (!myName) return;
      const { doc } = await getDoc(`/gallery/${myName}/`);
      const first = doc.querySelector("section.gallery figure");
      if (first) { st.floor = Math.max(st.floor, Number((first.id.match(/\d+/) || [])[0]) || 0); keep({ uploadFloor: st.floor }); }
      if (!doc.querySelector(".user-folders")) return;
      const out = [];
      for (const box of doc.querySelectorAll(".user-folders")) {
        let group = "";
        for (const e of box.querySelectorAll("h4, a[href*='/folder/']")) {
          if (e.tagName === "H4") { group = e.textContent.trim(); continue; }
          const id = (e.getAttribute("href").match(/\/folder\/(\d+)\//) || [])[1];
          if (id && !out.some((f) => f.v === id)) out.push({ v: id, n: e.textContent.trim(), g: e.closest("ul.default-group") ? "" : group });
        }
      }
      st.folderList = out;
      keep({ uploadFolders: out });
      renderFolders();
    }

    // ---------------------------------------------------------------- copy settings from a submission
    // A picker over your own gallery and scraps (search by title, or paste a link / ID). FA's edit page of
    // the chosen submission (/controls/submissions/changeinfo/<id>/) has every setting as you entered it,
    // BBCode included: rating, category, theme, species, description, keywords, folders, options.
    let picker = null;
    function openPicker() {
      if (picker) { picker.show(); return; }
      const ov = el("div", "faw-up-pick");
      const box = el("div", "faw-up-pick__box");
      const top = el("div", "faw-up-pick__top");
      const search = el("input", "faw-up__in faw-up-pick__search");
      search.placeholder = T("upCopySearch");
      const tabs = el("div", "faw-up__seg faw-up-pick__tabs");
      const close = btn("faw-up-pick__close", "×", () => hide());
      close.title = T("close");
      top.append(el("h3", null, T("upCopyTitle")), search, tabs, close);
      const info = el("p", "faw-up__hint", T("upCopyNote"));
      const gridEl = el("div", "faw-up-pick__grid");
      const more = btn("faw-up__btn faw-up-pick__more", T("upLoadMore"), () => load());
      box.append(top, info, gridEl, more);
      ov.append(box);
      document.body.append(ov);
      ov.addEventListener("click", (e) => { if (e.target === ov) hide(); });
      const onKey = (e) => { if (e.key === "Escape") hide(); };

      const src = { gallery: { items: [], page: 0, done: !myName }, scraps: { items: [], page: 0, done: !myName } };
      let cur = "gallery", busy = false;
      const tabBtns = ["gallery", "scraps"].map((k) => {
        const b = btn("faw-up__segbtn", T(k === "gallery" ? "upGallery" : "upScraps"), () => { cur = k; sync(); render(); if (!src[k].page) load(); });
        tabs.append(b);
        return [k, b];
      });
      const sync = () => { for (const [k, b] of tabBtns) b.classList.toggle("is-on", k === cur); };

      async function load() {
        const s = src[cur];
        if (busy || s.done || ov.hidden) return;
        busy = true; more.disabled = true; more.textContent = T("loading");
        try {
          const { doc } = await getDoc(`/${cur}/${myName}/${s.page + 1}/`);
          const figs = [...doc.querySelectorAll("section.gallery figure")];
          for (const f of figs) {
            const id = (f.id.match(/\d+/) || [])[0], img = f.querySelector("img");
            const t = f.querySelector("figcaption a[title]");
            if (id) s.items.push({ id, title: t ? t.getAttribute("title") : "#" + id, thumb: img ? new URL(img.getAttribute("src"), location.href).href : "" });
          }
          s.page++;
          if (!figs.length || !doc.querySelector(`a[href*="/${cur}/${myName}/${s.page + 1}/"], form[action*="/${cur}/${myName}/${s.page + 1}/"]`)) s.done = true;
        } catch (e) { s.done = true; }
        busy = false;
        render();
        // searching: keep reading pages until something matches (or the gallery ends, or the picker closes)
        if (search.value.trim() && !s.done && !ov.hidden && !visible().length) load();
      }
      const visible = () => {
        const q = search.value.trim().toLowerCase();
        return src[cur].items.filter((i) => !q || i.title.toLowerCase().includes(q));
      };
      function render() {
        gridEl.replaceChildren();
        const list = visible();
        for (const it of list) {
          const card = btn("faw-up-pick__item", null, () => apply(it.id, it.title));
          const im = el("img"); im.src = it.thumb; im.alt = ""; im.loading = "lazy";
          card.append(im, el("span", null, it.title));
          gridEl.append(card);
        }
        if (!myName) gridEl.append(el("p", "faw-up__hint", T("upNoUser")));
        else if (!list.length && !busy) gridEl.append(el("p", "faw-up__hint", src[cur].done ? T("upNoMatches") : T("loading")));
        more.hidden = src[cur].done;
        more.disabled = busy;
        more.textContent = T("upLoadMore");
      }
      let timer = null;
      search.addEventListener("input", () => {
        // a link or an ID copies that submission directly
        const id = (search.value.match(/(?:\/view\/|^\s*)(\d{5,})/) || [])[1];
        if (id) { apply(id, "#" + id); return; }
        clearTimeout(timer);
        timer = setTimeout(() => { render(); if (!visible().length) load(); }, 200);
      });
      gridEl.addEventListener("scroll", () => { if (gridEl.scrollTop + gridEl.clientHeight > gridEl.scrollHeight - 300) load(); });

      function show() { ov.hidden = false; document.addEventListener("keydown", onKey); search.focus(); }
      function hide() { ov.hidden = true; document.removeEventListener("keydown", onKey); }
      picker = { show, hide };
      sync(); show(); render(); load();
    }

    let undoState = null;
    async function apply(id, title) {
      if (picker) picker.hide();
      showCopied(T("upCopying", title));
      try {
        const { doc } = await getDoc(`/controls/submissions/changeinfo/${id}/`);
        const f = doc.querySelector(`form[action*="/changeinfo/"]`);
        if (!f) throw new Error(T("upNotYours"));
        undoState = JSON.parse(JSON.stringify({ rating: st.rating, cat: st.cat, atype: st.atype, species: st.species, folders: st.folders,
          lock: st.lock, scrap: st.scrap, desc: st.desc, keywords: st.keywords, genders: st.genders }));
        rememberLists(f);                                  // FA's current lists and your folders, as on that page
        if (st.lists) { fillSel(catSel, st.lists.cat, st.cat); fillSel(themeSel, st.lists.atype, st.atype); fillSel(specSel, st.lists.species, st.species); }
        const val = (sel) => { const n = f.querySelector(sel); return n ? n.value : ""; };
        const r = f.querySelector("input[name=rating]:checked");
        if (r) st.rating = r.value;
        setSel(catSel, "cat", val("select[name=cat]"));
        setSel(themeSel, "atype", val("select[name=atype]"));
        setSel(specSel, "species", val("select[name=species]"));
        st.desc = val("textarea[name=message]");
        st.keywords = []; st.genders = [];
        addKw(val("textarea[name=keywords]"), true);
        st.lock = !!f.querySelector("[name=lock_comments]:checked");
        st.scrap = !!f.querySelector("[name=scrap]:checked");
        st.folders = [...f.querySelectorAll("input[name='folder_ids[]']:checked")].map((c) => c.value);
        st.floor = Math.max(st.floor, Number(id) || 0);
        const realTitle = (f.querySelector("input[name=title]") || {}).value || title;
        desc.value = st.desc; queuePreview();
        syncRating(); syncChecks(); renderKw(); renderFolders(); savePrefs(); saveDraft();
        showCopied(T("upCopied", realTitle), id);
      } catch (err) {
        showCopied(T("upCopyFailed", err.message), null, true);
      }
    }
    function showCopied(text, id, bad) {
      copied.hidden = false;
      copied.classList.toggle("is-bad", !!bad);
      copied.replaceChildren(el("span", null, text));
      if (id) {
        const a = el("a", null, T("openPage")); a.href = "/view/" + id + "/"; a.target = "_blank";
        copied.append(a);
      }
      if (id && undoState) {
        copied.append(btn("faw-up__link", T("upUndo"), () => {
          Object.assign(st, undoState);
          undoState = null;
          catSel.value = st.cat; themeSel.value = st.atype; specSel.value = st.species; desc.value = st.desc; queuePreview();
          syncRating(); syncChecks(); renderKw(); renderFolders(); savePrefs(); saveDraft();
          copied.hidden = true;
        }));
      }
      copied.append(btn("faw-up__x faw-up__copiedx", "×", () => { copied.hidden = true; }));
    }

    // ---------------------------------------------------------------- image files
    // FA takes JPEG, PNG and GIF up to MAX_FILE_SIZE. Other types are converted; too large pictures are
    // re-encoded, then scaled down until they fit. Pictures with transparency stay PNG as long as possible
    // (JPEG has none: they get a white background then). Location data (EXIF, XMP) is removed if wanted.
    const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
    function drawn(bmp, scale, white) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
      const g = c.getContext("2d");
      if (white) { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(bmp, 0, 0, c.width, c.height);
      return c;
    }
    function hasAlpha(bmp) {
      const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
      const c = drawn(bmp, s, false);
      const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
      return false;
    }
    async function fitImage(file, stripGps) {
      let f = file;
      if (f.type === "image/jpeg" && stripGps) f = await stripExif(f);
      if (IMG_OK.test(f.type) && f.size <= maxSize) return f;
      if (f.type === "image/gif" && f.size > maxSize) throw new Error(T("upGifBig"));
      const bmp = await createImageBitmap(f).catch(() => { throw new Error(T("upCantRead")); });
      const base = (file.name || "image").replace(/\.[^.]+$/, "");
      const alpha = f.type !== "image/jpeg" && hasAlpha(bmp);
      const png = (b) => new File([b], base + ".png", { type: "image/png" });
      let scale = 1;
      for (let i = 0; i < 14; i++) {
        // PNG first (lossless; and the only way to keep transparency), for transparent pictures while
        // they're still at least about a third of their size
        if ((i === 0 && f.type !== "image/jpeg") || (alpha && i < 7)) {
          const b = await toBlob(drawn(bmp, scale, false), "image/png");
          if (b && b.size <= maxSize) return png(b);
          if (alpha && i < 6) { scale *= 0.85; continue; }
        }
        const c = drawn(bmp, scale, true);
        for (const qy of [0.92, 0.85, 0.75]) {
          const jpg = await toBlob(c, "image/jpeg", qy);
          if (jpg && jpg.size <= maxSize) return new File([jpg], base + ".jpg", { type: "image/jpeg" });
        }
        scale *= 0.85;
      }
      throw new Error(T("upTooBig"));
    }
    // a small JPEG for the list of finished uploads
    async function smallPreview(file) {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
      return toBlob(drawn(bmp, s, true), "image/jpeg", 0.8);
    }
    // Drops the EXIF block (APP1 "Exif") and XMP (APP1 Adobe XMP, may hold GPS too) from a JPEG without
    // re-encoding it. A photo that relies on the EXIF orientation is re-encoded upright instead, so it
    // doesn't end up sideways.
    async function stripExif(file) {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf[0] !== 0xFF || buf[1] !== 0xD8) return file;
      const parts = [buf.subarray(0, 2)];
      let p = 2, removed = false, rotated = false;
      while (p + 4 <= buf.length && buf[p] === 0xFF) {
        const m = buf[p + 1], len = (buf[p + 2] << 8) | buf[p + 3];
        if (m === 0xDA) break;                                         // image data starts: keep the rest
        const seg = buf.subarray(p, p + 2 + len);
        const sig = m === 0xE1 ? String.fromCharCode(...seg.subarray(4, Math.min(seg.length, 33))) : "";
        const isExif = sig.startsWith("Exif"), isXmp = sig.startsWith("http://ns.adobe.com/xap/");
        if (isExif || isXmp) { removed = true; if (isExif) rotated = exifOrientation(seg) > 1; } else parts.push(seg);
        p += 2 + len;
      }
      if (!removed) return file;
      if (rotated) {                                                   // bake the rotation in
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
        const jpg = await toBlob(drawn(bmp, 1, false), "image/jpeg", 0.95);
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
    // the form (text and its files' details; the files themselves are in IndexedDB) and the last choices
    let draftTimer = null;
    function saveDraft() {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => keep({ uploadDraft: { desc: st.desc, keywords: st.keywords, genders: st.genders,
        items: st.files.map((f) => ({ id: f.id, type: f.type, title: f.title, rating: f.rating, genders: f.genders, apart: f.apart, text: f.text, warn: f.warn })) } }), 400);
    }
    function savePrefs() {
      keep({ uploadPrefs: { rating: st.rating, cat: st.cat, atype: st.atype, species: st.species, folders: st.folders,
        lock: st.lock, scrap: st.scrap, stripGps: st.stripGps } });
    }

    // closing the tab in the middle of a send interrupts it (the queue itself is kept)
    window.addEventListener("beforeunload", (e) => { if (active && active.state === "busy") { e.preventDefault(); e.returnValue = ""; } });
    window.addEventListener("pagehide", () => { if (running) release(); });
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== "local") return;
        if (ch.uploadPing && !String(ch.uploadPing.newValue || "").startsWith(TAB + ":")) reloadJobs().then(() => { if (!running) runQueue(); });
        if (ch.uploadRunner && !ch.uploadRunner.newValue && !running) runQueue();   // the sending tab is done or gone
      });
    } catch (e) { /* reloaded */ }
    // while another tab sends: look now and then whether it's still there
    setInterval(() => { if (!running) runQueue(); }, 10000);

    (async () => {
      const l = await store({ uploadPrefs: {}, uploadDraft: null, uploadLists: null, uploadFolders: [], uploadKeywords: [], uploadFloor: 0, uploadRunner: null });
      Object.assign(st, {
        rating: "", cat: "1", atype: "1", species: "1", folders: [], lock: false, scrap: false, stripGps: true
      }, l.uploadPrefs || {});
      const d = l.uploadDraft || {};
      Object.assign(st, { desc: d.desc || "", keywords: d.keywords || [], genders: d.genders || [] });
      st.folderList = Array.isArray(l.uploadFolders) ? l.uploadFolders.map((f) => (/^folders not in/i.test(f.g || "") ? Object.assign({}, f, { g: "" }) : f)) : [];
      st.usedKw = Array.isArray(l.uploadKeywords) ? l.uploadKeywords : [];
      st.floor = Number(l.uploadFloor) || 0;
      addSuggestions(st.usedKw.slice(0, 300));
      desc.value = st.desc; queuePreview();
      syncChecks(); syncRating(); renderKw(); renderFolders(); renderFiles();
      // the form's files from last time
      for (const m of Array.isArray(d.items) ? d.items : []) {
        const rec = await DB.files(m.id).catch(() => null);
        if (rec && rec.file) st.files.push(Object.assign({ genders: null, apart: false, warn: "" }, m, { file: rec.file, thumb: rec.thumb || null }));
      }
      // the queue (uploads cut off last time are recovered by runQueue, once no other tab is sending)
      jobs = ((await DB.jobs().catch(() => [])) || []).sort((a, b) => a.created - b.created);
      const r = l.uploadRunner, othersSend = r && r.tab !== TAB && Date.now() - r.at < 20000;
      await loadFiles();
      // files nothing refers to any more (removed elsewhere, or from an older form)
      const used = new Set([...st.files.map((f) => f.id), ...jobs.filter((q) => q.state !== "done").map((q) => q.id)]);
      if (!othersSend) for (const id of (await DB.fileIds().catch(() => [])) || []) if (!used.has(id)) DB.delFiles(id).catch(() => {});
      renderFiles(); renderQueue();
      runQueue();
      // FA's lists: from the last details page, else from the browse page (same values)
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
      loadGallery().catch(() => {});
    })();
  }
})();
