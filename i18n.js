// Extension language (popup + texts the extension adds to FA pages): English, Deutsch, Русский.
// "auto" follows the browser language. Loaded before popup.js and before features.js.
const FAW_I18N = {
  en: {
    // popup
    tagline: "Fur Affinity, tuned for wide screens",
    masterTitle: "Turn the whole extension on / off",
    ultrawide: "Ultrawide layout", ultrawideSub: "Width, comments beside the image, profile layout",
    maxWidth: "Max site width", gutter: "Side gutter", thumbSize: "Thumbnail size", noCap: "no cap",
    imageFit: "Fit image to screen", imageFitSub: "Click the image for a full-screen view",
    design: "Bubbles design", designSub: "Comments, shouts, buttons, panels, comment box, arrows, avatars for watchers",
    features: "Features",
    quickView: "Quick view", quickViewSub: "Click thumbnails to open a popup",
    comic: "Comic reader", comicSub: "Loads every page of a series",
    comicH: "Horizontal reading", comicHSub: "Pages side by side, wheel or ← → to turn",
    infinite: "Infinite scroll", infiniteSub: "Galleries, favorites, browse, search",
    bbExtra: "Extra comment buttons", bbExtraSub: "Strikethrough, headings, colour, quote, spoiler, links…",
    archive: "Archived Gallery link", archiveSub: "furarchiver.net, in profile headers & on unavailable accounts",
    applyNote: "Changes apply on next page load", reset: "Reset",
    // comic
    readComic: "Read as comic", readComicN: "Read as comic ({0} pages)", singlePage: "Show single page",
    loadingPagesFound: "Loading… {0} pages found", seriesFailed: "Couldn't load series: {0}",
    pageOf: "Page {0}/{1} · ", untitled: "Untitled",
    // archive / external links
    archivedGallery: "Archived Gallery", archiveTitle: "Backup of this gallery on furarchiver.net (external site)",
    accountUnavailable: "This account isn't available. An archived copy of the gallery may exist:",
    openArchive: "Open the archived gallery of “{0}” on furarchiver.net?",
    leavingFA: "You are leaving Fur Affinity for:", cancel: "Cancel", openNewTab: "Open in new tab",
    // watchers
    loadingEntries: "Loading all entries…", loadingEntriesN: "Loading all entries… {0} so far",
    entriesN: "{0} entries", stoppedAfter: "Stopped after {0} entries ({1})",
    // comment toolbar
    bbStrike: "Strikethrough", bbSup: "Superscript", bbSub: "Subscript", bbH1: "Heading 1", bbH2: "Heading 2", bbH3: "Heading 3",
    bbColor: "Text colour", bbQuote: "Quote", bbSpoiler: "Spoiler", bbLink: "Link (select a URL or text)",
    bbYt: "YouTube video", bbIcon: "User icon  :iconname:", bbUlink: "User link  :linkname:", bbHr: "Horizontal line",
    // submission
    newerSub: "Newer submission", olderSub: "Older submission", moreFrom: "More from {0}", viewGallery: "View gallery",
    // infinite scroll
    pageDivider: "— page {0} —", pagesLoaded: "{0} pages loaded · scroll for more", by: "by", category: "Category", species: "Species", resolution: "Resolution", rating: "Rating",
    qvHint: "← → browse · F fav · D download · click image to zoom · Esc close",
    scrollMore: "Scroll for more", loadingPage: "Loading page {0}…", endPages: "End · {0} pages loaded",
    noMore: "No more submissions", pageFailed: "Couldn't load page {0} ({1}) ", retry: "Retry",
    // quick view
    prev: "Previous (←)", next: "Next (→)", close: "Close (Esc)", download: "Download", openPage: "Open page",
    comments: "Comments", writeComment: "Write a comment…", post: "Post", noComments: "No comments yet.",
    posting: "Posting…", posted: "Posted", postFailed: "Couldn't post ({0})", loading: "Loading…",
    loadFailed: "Couldn't load submission ({0})", favFailed: "Fav failed", loadingFull: "loading full quality…"
  },
  de: {
    tagline: "Fur Affinity, optimiert für breite Bildschirme",
    masterTitle: "Erweiterung komplett ein- / ausschalten",
    ultrawide: "Ultrawide-Layout", ultrawideSub: "Breite, Kommentare neben dem Bild, Profil-Layout",
    maxWidth: "Max. Seitenbreite", gutter: "Seitenrand", thumbSize: "Vorschaugröße", noCap: "unbegrenzt",
    imageFit: "Bild an Bildschirm anpassen", imageFitSub: "Klick aufs Bild öffnet die Vollbildansicht",
    design: "Bubbles-Design", designSub: "Kommentare, Shouts, Buttons, Panels, Kommentarfeld, Pfeile, Avatare der Watcher",
    features: "Funktionen",
    quickView: "Schnellansicht", quickViewSub: "Vorschaubilder öffnen ein Popup",
    comic: "Comic-Leser", comicSub: "Lädt alle Seiten einer Serie",
    comicH: "Horizontal lesen", comicHSub: "Seiten nebeneinander, Mausrad oder ← → zum Blättern",
    infinite: "Endlos-Scrollen", infiniteSub: "Galerien, Favoriten, Browse, Suche",
    bbExtra: "Zusätzliche Kommentar-Buttons", bbExtraSub: "Durchgestrichen, Überschriften, Farbe, Zitat, Spoiler, Links…",
    archive: "Link „Archivierte Galerie“", archiveSub: "furarchiver.net, im Profilkopf & bei nicht verfügbaren Konten",
    applyNote: "Änderungen gelten ab dem nächsten Seitenaufruf", reset: "Zurücksetzen",
    readComic: "Als Comic lesen", readComicN: "Als Comic lesen ({0} Seiten)", singlePage: "Einzelseite anzeigen",
    loadingPagesFound: "Lädt… {0} Seiten gefunden", seriesFailed: "Serie konnte nicht geladen werden: {0}",
    pageOf: "Seite {0}/{1} · ", untitled: "Ohne Titel",
    archivedGallery: "Archivierte Galerie", archiveTitle: "Sicherung dieser Galerie auf furarchiver.net (externe Seite)",
    accountUnavailable: "Dieses Konto ist nicht verfügbar. Eventuell gibt es eine archivierte Kopie der Galerie:",
    openArchive: "Archivierte Galerie von „{0}“ auf furarchiver.net öffnen?",
    leavingFA: "Du verlässt Fur Affinity in Richtung:", cancel: "Abbrechen", openNewTab: "In neuem Tab öffnen",
    loadingEntries: "Lade alle Einträge…", loadingEntriesN: "Lade alle Einträge… bisher {0}",
    entriesN: "{0} Einträge", stoppedAfter: "Abgebrochen nach {0} Einträgen ({1})",
    bbStrike: "Durchgestrichen", bbSup: "Hochgestellt", bbSub: "Tiefgestellt", bbH1: "Überschrift 1", bbH2: "Überschrift 2", bbH3: "Überschrift 3",
    bbColor: "Textfarbe", bbQuote: "Zitat", bbSpoiler: "Spoiler", bbLink: "Link (URL oder Text markieren)",
    bbYt: "YouTube-Video", bbIcon: "Nutzer-Icon  :iconname:", bbUlink: "Nutzer-Link  :linkname:", bbHr: "Trennlinie",
    newerSub: "Neuere Einreichung", olderSub: "Ältere Einreichung", moreFrom: "Mehr von {0}", viewGallery: "Zur Galerie",
    pageDivider: "— Seite {0} —", pagesLoaded: "{0} Seiten geladen · scrollen für mehr", by: "von", category: "Kategorie", species: "Spezies", resolution: "Auflösung", rating: "Einstufung",
    qvHint: "← → blättern · F Fav · D Download · Klick ins Bild zum Zoomen · Esc schließen",
    scrollMore: "Scrollen für mehr", loadingPage: "Lade Seite {0}…", endPages: "Ende · {0} Seiten geladen",
    noMore: "Keine weiteren Einreichungen", pageFailed: "Seite {0} konnte nicht geladen werden ({1}) ", retry: "Erneut versuchen",
    prev: "Zurück (←)", next: "Weiter (→)", close: "Schließen (Esc)", download: "Herunterladen", openPage: "Seite öffnen",
    comments: "Kommentare", writeComment: "Kommentar schreiben…", post: "Senden", noComments: "Noch keine Kommentare.",
    posting: "Wird gesendet…", posted: "Gesendet", postFailed: "Senden fehlgeschlagen ({0})", loading: "Lädt…",
    loadFailed: "Einreichung konnte nicht geladen werden ({0})", favFailed: "Fav fehlgeschlagen", loadingFull: "lade volle Qualität…"
  },
  ru: {
    tagline: "Fur Affinity для широких экранов",
    masterTitle: "Включить / выключить расширение",
    ultrawide: "Широкий макет", ultrawideSub: "Ширина, комментарии рядом с изображением, макет профиля",
    maxWidth: "Макс. ширина сайта", gutter: "Боковой отступ", thumbSize: "Размер миниатюр", noCap: "без ограничения",
    imageFit: "Вписать изображение в экран", imageFitSub: "Нажмите на изображение для полноэкранного просмотра",
    design: "Дизайн «Bubbles»", designSub: "Комментарии, шауты, кнопки, панели, поле комментария, стрелки, аватары подписчиков",
    features: "Функции",
    quickView: "Быстрый просмотр", quickViewSub: "Миниатюры открываются во всплывающем окне",
    comic: "Чтение комиксов", comicSub: "Загружает все страницы серии",
    comicH: "Горизонтальное чтение", comicHSub: "Страницы рядом, колесо мыши или ← → для листания",
    infinite: "Бесконечная прокрутка", infiniteSub: "Галереи, избранное, обзор, поиск",
    bbExtra: "Доп. кнопки комментариев", bbExtraSub: "Зачёркивание, заголовки, цвет, цитата, спойлер, ссылки…",
    archive: "Ссылка «Архив галереи»", archiveSub: "furarchiver.net, в шапке профиля и у недоступных аккаунтов",
    applyNote: "Изменения применятся при следующей загрузке страницы", reset: "Сброс",
    readComic: "Читать как комикс", readComicN: "Читать как комикс ({0} стр.)", singlePage: "Показать одну страницу",
    loadingPagesFound: "Загрузка… найдено страниц: {0}", seriesFailed: "Не удалось загрузить серию: {0}",
    pageOf: "Страница {0}/{1} · ", untitled: "Без названия",
    archivedGallery: "Архив галереи", archiveTitle: "Резервная копия галереи на furarchiver.net (внешний сайт)",
    accountUnavailable: "Этот аккаунт недоступен. Возможно, существует архивная копия галереи:",
    openArchive: "Открыть архив галереи «{0}» на furarchiver.net?",
    leavingFA: "Вы покидаете Fur Affinity и переходите на:", cancel: "Отмена", openNewTab: "Открыть в новой вкладке",
    loadingEntries: "Загрузка всех записей…", loadingEntriesN: "Загрузка всех записей… пока {0}",
    entriesN: "Записей: {0}", stoppedAfter: "Остановлено после {0} записей ({1})",
    bbStrike: "Зачёркнутый", bbSup: "Надстрочный", bbSub: "Подстрочный", bbH1: "Заголовок 1", bbH2: "Заголовок 2", bbH3: "Заголовок 3",
    bbColor: "Цвет текста", bbQuote: "Цитата", bbSpoiler: "Спойлер", bbLink: "Ссылка (выделите URL или текст)",
    bbYt: "Видео YouTube", bbIcon: "Иконка пользователя  :iconname:", bbUlink: "Ссылка на пользователя  :linkname:", bbHr: "Горизонтальная линия",
    newerSub: "Более новая работа", olderSub: "Более старая работа", moreFrom: "Ещё от {0}", viewGallery: "Открыть галерею",
    pageDivider: "— страница {0} —", pagesLoaded: "Загружено страниц: {0} · прокрутите дальше", by: "автор", category: "Категория", species: "Вид", resolution: "Разрешение", rating: "Рейтинг",
    qvHint: "← → листать · F избранное · D скачать · клик по изображению — масштаб · Esc закрыть",
    scrollMore: "Прокрутите, чтобы увидеть больше", loadingPage: "Загрузка страницы {0}…", endPages: "Конец · загружено страниц: {0}",
    noMore: "Больше работ нет", pageFailed: "Не удалось загрузить страницу {0} ({1}) ", retry: "Повторить",
    prev: "Назад (←)", next: "Вперёд (→)", close: "Закрыть (Esc)", download: "Скачать", openPage: "Открыть страницу",
    comments: "Комментарии", writeComment: "Напишите комментарий…", post: "Отправить", noComments: "Комментариев пока нет.",
    posting: "Отправка…", posted: "Отправлено", postFailed: "Не удалось отправить ({0})", loading: "Загрузка…",
    loadFailed: "Не удалось загрузить работу ({0})", favFailed: "Не удалось добавить в избранное", loadingFull: "загрузка полного качества…"
  }
};
let FAW_LANG = "en";
function fawSetLang(pref) {
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  const want = !pref || pref === "auto" ? nav : pref;
  FAW_LANG = FAW_I18N[want] ? want : "en";
  return FAW_LANG;
}
function T(key, ...args) {
  const s = (FAW_I18N[FAW_LANG] && FAW_I18N[FAW_LANG][key]) || FAW_I18N.en[key] || key;
  return s.replace(/\{(\d)\}/g, (_, i) => (args[i] !== undefined ? args[i] : ""));
}
fawSetLang("auto");
