import { firebaseConfig, googleClientId, allowedEmail } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithCredential, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, uploadBytes, getDownloadURL, deleteObject, updateMetadata, getBlob } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

var DEFAULT_FOLDERS = ["Esports Skills, Strategies and Analysis", "ASBW", "Introduction to Esports", "Enterprise & Entrepreneurship in Esports", "Esports Coaching", "Video Production", "Games Design", "Health, Wellbeing and Fitness for Esports Players", "GCSE Maths", "Home"];
var TAGS = ["Draft", "Todo", "Feedback", "Submitted"];
var MAX_VERSIONS = 5, BIN_DAYS = 30, RECENT_DAYS = 14, DAY = 86400000;
var JUNK = /^(~\$|\.~lock|Thumbs\.db$|desktop\.ini$|\.DS_Store$)/i;
var FREE_BYTES = 5 * 1073741824, SHARE_HOURS = 24;
/* Weekly timetable used to file uploads into the lecture you're in (from Gower Hub). Times run to 15 minutes after the end. */
var LECTURES = {
  1: [["09:30", "11:30", "Esports Skills, Strategies and Analysis"], ["11:45", "13:15", "ASBW"], ["15:30", "16:30", "Introduction to Esports"]],
  3: [["09:30", "10:30", "Enterprise & Entrepreneurship in Esports"], ["11:00", "12:30", "Esports Coaching"], ["13:15", "14:45", "Introduction to Esports"], ["15:00", "16:30", "ASBW"]],
  4: [["09:00", "10:30", "Video Production"], ["11:00", "12:30", "Esports Skills, Strategies and Analysis"], ["13:00", "14:15", "GCSE Maths"], ["14:30", "15:45", "GCSE Maths"]],
  5: [["09:30", "11:00", "Games Design"], ["11:00", "12:15", "Enterprise & Entrepreneurship in Esports"], ["13:30", "15:00", "Health, Wellbeing and Fitness for Esports Players"]]
};
var LECTURE_NAMES = ["Esports Skills, Strategies and Analysis", "ASBW", "Introduction to Esports", "Enterprise & Entrepreneurship in Esports", "Esports Coaching", "Video Production", "Games Design", "Health, Wellbeing and Fitness for Esports Players", "GCSE Maths"];
var PREVIEW = { pdf: "pdf", png: "img", jpg: "img", jpeg: "img", gif: "img", webp: "img", txt: "text", md: "text", csv: "text", docx: "docx" };

if (firebaseConfig.apiKey.indexOf("PASTE") === 0) {
  $("gateMsg").textContent = "Firebase isn't set up yet. Open SETUP.md and fill in firebase-config.js.";
  $("signIn").hidden = true;
  throw new Error("firebase-config.js not filled in");
}

var app = initializeApp(firebaseConfig);
var auth = getAuth(app), db = getFirestore(app), storage = getStorage(app);
var uid = null, folders = [], files = [], cur = "all", sel = {}, open = {}, sure = null, sureTimer = null, editing = null, pending = false, unsubs = [], purged = false, replaceId = null;

function note(msg) { var n = $("note"); n.hidden = !msg; n.textContent = msg || ""; }
window.addEventListener("error", function (e) { note("Something went wrong: " + (e.message || "unknown error")); });
window.addEventListener("unhandledrejection", function (e) { note("Something went wrong: " + ((e.reason && (e.reason.code || e.reason.message)) || "unknown error")); });

function popupSignIn() {
  var p = new GoogleAuthProvider();
  signInWithPopup(auth, p).catch(function (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/cancelled-popup-request" || e.code === "auth/operation-not-supported-in-this-environment") return signInWithRedirect(auth, p);
    $("gateMsg").textContent = "Sign-in failed (" + (e.code || e.message) + ").";
  });
}
/* Google's own sign-in button only talks to google.com, so it works on networks that block Firebase's sign-in page (like college). */
function setupGoogleButton() {
  if (!googleClientId || googleClientId.indexOf("PASTE") === 0) return;
  var s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
  s.onload = function () {
    try {
      google.accounts.id.initialize({ client_id: googleClientId, auto_select: true, callback: function (r) {
        $("gateMsg").textContent = "Signing in...";
        signInWithCredential(auth, GoogleAuthProvider.credential(r.credential)).catch(function (e) { $("gateMsg").textContent = "Sign-in failed (" + (e.code || e.message) + ")."; });
      } });
      google.accounts.id.renderButton($("gBtn"), { theme: "filled_blue", size: "large", text: "signin_with", shape: "pill" });
      $("signIn").textContent = "Other way to sign in";
      $("signIn").className = "link";
    } catch (e) {}
  };
  document.head.appendChild(s);
}
setupGoogleButton();
$("signIn").addEventListener("click", popupSignIn);
$("signOut").addEventListener("click", function () { try { google.accounts.id.disableAutoSelect(); } catch (e) {} signOut(auth); });

onAuthStateChanged(auth, function (u) {
  unsubs.forEach(function (f) { f(); }); unsubs = [];
  if (!u) { uid = null; $("gate").hidden = false; $("app").hidden = true; return; }
  if (allowedEmail && String(u.email || "").toLowerCase() !== allowedEmail.toLowerCase()) {
    $("gateMsg").textContent = "Gower Files is private. " + (u.email || "That account") + " can't use it.";
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    $("gate").hidden = false; $("app").hidden = true; uid = null;
    signOut(auth); return;
  }
  uid = u.uid; purged = false;
  $("gate").hidden = true; $("app").hidden = false;
  $("who").textContent = u.email || "";
  start();
});

function fcol() { return collection(db, "users", uid, "folders"); }
function filecol() { return collection(db, "users", uid, "files"); }

function start() {
  var initRef = doc(db, "users", uid, "meta", "init");
  getDoc(initRef).then(function (s) {
    if (s.exists()) return;
    var b = writeBatch(db);
    b.set(doc(fcol(), "home"), { name: "Home", order: 0 });
    b.set(initRef, { at: Date.now() });
    return b.commit();
  }).catch(function (e) { note("Couldn't set up folders: " + e.message); });
  unsubs.push(onSnapshot(fcol(), function (s) {
    folders = s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(b.name); });
    foldersLoaded = true; maybeTidy();
    if (!SY.inited) { SY.inited = true; initSync(); } else renderSync();
    liveRender();
  }, function (e) { note("Can't load folders: " + e.message); }));
  unsubs.push(onSnapshot(filecol(), function (s) {
    files = s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
    if (!purged) { purged = true; purgeBin(); cleanShares(); }
    filesLoaded = true; maybeTidy();
    liveRender();
  }, function (e) { note("Can't load files: " + e.message); }));
}

/* ---------- helpers ---------- */
function byId(id) { for (var i = 0; i < files.length; i++) if (files[i].id === id) return files[i]; return null; }
function folderName(id) {
  if (!id || id === "inbox") return "Inbox";
  for (var i = 0; i < folders.length; i++) if (folders[i].id === id) return folders[i].name;
  return "Inbox";
}
function realFolder(id) { if (!id || id === "inbox") return "inbox"; return folders.some(function (f) { return f.id === id; }) ? id : "inbox"; }
function changedAt(f) { return f.updatedAt || f.createdAt || 0; }
function fmtSize(n) { if (n < 1024) return n + " B"; if (n < 1048576) return Math.round(n / 1024) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(2) + " GB"; }
function fmtDate(ms) { return new Date(ms).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
function extOf(n) { var i = n.lastIndexOf("."); return i > 0 && i < n.length - 1 ? n.slice(i + 1).toLowerCase() : ""; }
function dispo(n) { return "attachment; filename*=UTF-8''" + encodeURIComponent(n); }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function safeName(n) { return n.replace(/[\/\\#?\[\]*]/g, "_"); }
function allPaths(f) { return [f.path].concat((f.versions || []).map(function (v) { return v.path; })); }
function isTyping() { var a = document.activeElement; return !!(a && a.tagName === "INPUT" && a.type === "text" && $("files").contains(a)); }

/* Live updates wait while you're typing in a box, so it isn't wiped. */
function liveRender() { if (editing || isTyping()) { pending = true; return; } render(); }
document.addEventListener("focusout", function () { setTimeout(function () { if (pending && !editing && !isTyping()) render(); }, 0); });

/* ---------- render ---------- */
var urlApplied = false;
function applyUrl() {
  if (urlApplied || !folders.length) return;
  urlApplied = true;
  try {
    var p = new URLSearchParams(location.search), fo = p.get("folder"), q = p.get("q"), lec = p.get("lecture");
    if (lec) { var ln = LECTURE_NAMES.filter(function (n) { return n.toLowerCase() === lec.toLowerCase(); })[0]; if (ln) cur = "lec:" + ln; }
    if (fo) { var m = folders.filter(function (f) { return String(f.name).toLowerCase() === fo.toLowerCase(); })[0]; if (m) cur = m.id; }
    if (q) $("q").value = q;
    if (fo || q || lec) history.replaceState(null, "", location.pathname);
  } catch (e) {}
}
function londonParts() {
  var o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; });
  return { date: o.year + "-" + o.month + "-" + o.day, min: +o.hour * 60 + +o.minute, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday) };
}
function hm(s) { var p = s.split(":"); return +p[0] * 60 + +p[1]; }
/* The lecture you're in right now (or just left, up to 15 minutes), matched to a folder by name. */
function lectureNow() {
  if (!autoFile) return null;
  var n = londonParts(), list = LECTURES[n.dow] || [], hit = null;
  list.forEach(function (l) { if (n.min >= hm(l[0]) && n.min < hm(l[1]) + 15) hit = l; });
  return hit ? hit[2] : null;
}
function level3Id() { var l = folders.filter(function (f) { return /level\s*3/i.test(f.name); })[0]; return l ? l.id : ""; }
function curLecture() { return cur.indexOf("lec:") === 0 ? cur.slice(4) : ""; }
function lecShort(n) { return n === "Health, Wellbeing and Fitness for Esports Players" ? "Health & Wellbeing" : n === "Esports Skills, Strategies and Analysis" ? "Skills & Strategies" : n === "Enterprise & Entrepreneurship in Esports" ? "Enterprise" : n; }
/* "New since last time": each device remembers when you last looked. Files added or changed after that on
   another device (or before this device started tagging uploads) get a New tag and their own chip. */
var DEVICE = "", LAST_SEEN = 0;
try {
  DEVICE = localStorage.getItem("gf-device") || ""; if (!DEVICE) { DEVICE = newId(); localStorage.setItem("gf-device", DEVICE); }
  LAST_SEEN = +localStorage.getItem("gf-lastseen") || 0;
} catch (e) {}
function markSeen() { try { localStorage.setItem("gf-lastseen", String(Date.now())); } catch (e) {} }
document.addEventListener("visibilitychange", function () { if (document.hidden) markSeen(); });
window.addEventListener("pagehide", markSeen);
function isNew(f) { return LAST_SEEN && changedAt(f) > LAST_SEEN && f.by !== DEVICE; }
var autoFile = true;
try { autoFile = localStorage.getItem("gf-autofile") !== "off"; } catch (e) {}
function render() {
  pending = false;
  applyUrl();
  var live = files.filter(function (f) { return !f.deletedAt; }), binned = files.filter(function (f) { return f.deletedAt; });
  var now = Date.now(), recent = live.filter(function (f) { return now - changedAt(f) < RECENT_DAYS * DAY; });
  var today = londonParts().date, todays = live.filter(function (f) { return f.today === today; });
  var dups = findDuplicates(live); dupOf = dups.of;
  var news = live.filter(isNew);
  var counts = { new: news.length, all: live.length, today: todays.length, recent: Math.min(recent.length, 20), bin: binned.length, dups: dups.list.length };
  live.forEach(function (f) { var k = realFolder(f.folder); counts[k] = (counts[k] || 0) + 1; });
  var tabs = [["all", "All"], ["new", "New"], ["today", "For today"], ["recent", "Recent"], ["inbox", "Inbox"]].concat(folders.map(function (f) { return [f.id, f.name]; }), dups.list.length || cur === "dups" ? [["dups", "Duplicates"]] : [], [["bin", "Bin"]]);
  live.forEach(function (f) { if (f.lecture) counts["lec:" + f.lecture] = (counts["lec:" + f.lecture] || 0) + 1; });
  if (!tabs.some(function (t) { return t[0] === cur; }) && !curLecture()) cur = "all";
  var nowLec = lectureNow(), l3 = level3Id();
  /* Lecture folders live inside Level 3: they show when Level 3 or one of its lectures is open. */
  var inL3 = !!curLecture() || (l3 && cur === l3);
  $("lecChips").hidden = !l3;
  $("lecChips").innerHTML = '<span class="hint">Level 3 \u203a</span>' + LECTURE_NAMES.map(function (n) {
    return '<button type="button" data-act="cur" data-id="' + esc("lec:" + n) + '" aria-pressed="' + (cur === "lec:" + n) + '"' + (n === nowLec ? ' class="nowlec" title="You\'re in this lecture now"' : "") + ">\u{1F4C1} " + esc(lecShort(n)) + " (" + (counts["lec:" + n] || 0) + ")</button>";
  }).join("");
  var inBin = cur === "bin";
  /* Keep the row short: For today, Inbox and Bin only show when they have something in them (or are open). */
  tabs = tabs.filter(function (t) { return ["new", "today", "inbox", "bin"].indexOf(t[0]) < 0 || counts[t[0]] || cur === t[0]; });
  $("chips").innerHTML = tabs.map(function (t) { return '<button type="button" data-act="cur" data-id="' + esc(t[0]) + '" aria-pressed="' + (t[0] === cur || (curLecture() && t[0] === l3)) + '">' + esc(t[1]) + " (" + (counts[t[0]] || 0) + ")</button>"; }).join("");
  var tl = targetLecture();
  $("target").textContent = "Uploads go to: " + (realTarget() === "inbox" ? "Inbox" : folderName(realTarget())) + (tl ? ", tagged " + lecShort(tl) + (tl === lectureNow() && !curLecture() ? " (you're in it now)" : "") : "") + ".";

  var tf = $("tagF").value;
  $("tagF").innerHTML = '<option value="">Any tag</option>' + TAGS.map(function (t) { return '<option' + (t === tf ? " selected" : "") + ">" + t + "</option>"; }).join("");

  var q = $("q").value.trim().toLowerCase(), sort = $("sort").value, list;
  if (inBin) list = binned.slice();
  else if (cur === "today") list = todays.slice();
  else if (cur === "new") list = news.slice();
  else if (cur === "dups") list = dups.list.slice();
  else if (curLecture()) list = live.filter(function (f) { return f.lecture === curLecture(); });
  else if (cur === "recent") list = recent.slice().sort(function (a, b) { return changedAt(b) - changedAt(a); }).slice(0, 20);
  else list = live.filter(function (f) { return cur === "all" || realFolder(f.folder) === cur; });
  list = list.filter(function (f) {
    if (tf && (f.tags || []).indexOf(tf) < 0) return false;
    if (!q) return true;
    return (f.name + " " + (f.note || "") + " " + (f.tags || []).join(" ") + " " + (f.rel || "")).toLowerCase().indexOf(q) >= 0;
  });
  if (cur !== "recent" && cur !== "dups") list.sort(function (a, b) {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "size") return (b.size || 0) - (a.size || 0);
    if (sort === "old") return changedAt(a) - changedAt(b);
    return changedAt(b) - changedAt(a);
  });
  $("count").textContent = list.length + (list.length === 1 ? " file" : " files") + (inBin ? " in the bin · removed for good after " + BIN_DAYS + " days" : cur === "recent" ? " changed in the last " + RECENT_DAYS + " days" : cur === "today" ? " set aside for today (clears tomorrow)" : cur === "new" ? " added or changed somewhere else since you last opened Gower Files here" : cur === "dups" ? " that look like copies of each other, grouped together. Keep one of each and delete the rest." : "");
  $("zipBtn").hidden = inBin || !list.length;
  $("emptyBin").hidden = !inBin || !list.length;
  $("sortLec").hidden = !(l3 && cur === l3 && live.some(function (f) { return f.folder === l3 && !f.lecture; }));
  $("emptyBin").textContent = sure === "empty" ? "Tap again to empty the bin" : "Empty bin";
  $("emptyBin").classList.toggle("sure", sure === "empty");

  $("files").innerHTML = list.length ? list.map(function (f) { return inBin ? binRow(f) : fileRow(f); }).join("")
    : '<div class="none">' + (cur === "dups" ? "No duplicates found." : inBin ? "The bin is empty." : cur === "today" ? "Nothing set aside for today. Tap \u201cFor today\u201d under a file." : live.length ? "No files match." : "No files yet. Drop some above.") + "</div>";

  $("folderRows").innerHTML = folders.map(function (f) {
    var ed = editing === "fo:" + f.id, rmOn = sure === "fo:" + f.id;
    return '<div class="frow">' + (ed ? '<form class="inline" style="flex:1" data-act="fRenameForm" data-id="' + esc(f.id) + '"><input type="text" id="renameIn" value="' + esc(f.name) + '" maxlength="60"><button class="btn" type="submit">Save</button><button class="btn alt" type="button" data-act="renameCancel">Cancel</button></form>' : "<span>" + esc(f.name) + ' <span class="hint">(' + (counts[f.id] || 0) + ")</span></span>") +
      (ed ? "" : '<span><button class="link" type="button" data-act="fRename" data-id="' + esc(f.id) + '">Rename</button> <button class="link warn' + (rmOn ? " sure" : "") + '" type="button" data-act="fRm" data-id="' + esc(f.id) + '">' + (rmOn ? "Tap again" : "Delete") + "</button></span>") + "</div>";
  }).join("");

  Object.keys(sel).forEach(function (k) { var f = byId(k); if (!sel[k] || !f || f.deletedAt) delete sel[k]; });
  var n = Object.keys(sel).length;
  $("bulk").hidden = !n || inBin;
  $("bulkN").textContent = n + " selected";
  var keep = $("bulkTo").value;
  $("bulkTo").innerHTML = '<option value="inbox">Inbox</option>' + folders.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + "</option>"; }).join("");
  if (keep) $("bulkTo").value = keep;
  if (!$("bulkLecTo").options.length) $("bulkLecTo").innerHTML = '<option value="-">No lecture folder</option>' + LECTURE_NAMES.map(function (n) { return '<option value="' + esc(n) + '">Level 3 \u203a ' + esc(lecShort(n)) + "</option>"; }).join("");
  var total = 0; files.forEach(function (f) { total += f.size || 0; (f.versions || []).forEach(function (v) { total += v.size || 0; }); });
  var pc = Math.min(100, total / FREE_BYTES * 100);
  $("usage").innerHTML = '<div class="meter"><span style="width:' + pc.toFixed(1) + '%"' + (pc > 80 ? ' class="hi"' : "") + '></span></div>' + esc(live.length + " files · " + fmtSize(total) + " of the 5 GB free allowance used (" + (pc < 1 && total ? "under 1" : Math.round(pc)) + "%), including older versions and the bin");
  $("autoFile").checked = autoFile;
  if (editing) { var i = $("renameIn"); if (i) { i.focus(); i.select(); } }
}

/* Duplicates: same content fingerprint (files uploaded from now on), or same size plus the same name or the same
   date from your computer. Copies are grouped together, newest first in each group. */
function baseName(n) { return String(n).toLowerCase().replace(/\.[^.]+$/, "").replace(/\s*(\(\d+\)|- copy( \(\d+\))?|copy)$/, "").trim(); }
function findDuplicates(live) {
  var parent = {}, find = function (x) { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  live.forEach(function (f) { parent[f.id] = f.id; });
  var keys = {};
  live.forEach(function (f) {
    var ks = [];
    if (f.hash) ks.push("h:" + f.hash);
    if (f.size) { ks.push("n:" + f.size + ":" + baseName(f.name)); if (f.srcModified) ks.push("m:" + f.size + ":" + f.srcModified); }
    ks.forEach(function (k) { if (keys[k]) parent[find(f.id)] = find(keys[k]); else keys[k] = f.id; });
  });
  var groups = {};
  live.forEach(function (f) { var r = find(f.id); (groups[r] = groups[r] || []).push(f); });
  var list = [], of = {};
  Object.keys(groups).forEach(function (r) {
    var g = groups[r]; if (g.length < 2) return;
    g.sort(function (a, b) { return changedAt(b) - changedAt(a); });
    g.forEach(function (f) { of[f.id] = g.length; list.push(f); });
  });
  return { list: list, of: of };
}
var dupOf = {};
function fileRow(f) {
  var isEd = editing === f.id, rmOn = sure === "rm:" + f.id, ext = extOf(f.name), vs = f.versions || [], tags = f.tags || [];
  var meta = "<span>" + fmtSize(f.size || 0) + "</span><span>" + (f.updatedAt ? "Updated " : "") + fmtDate(changedAt(f)) + "</span><span>" + esc(folderName(f.folder) + (f.lecture ? " \u203a " + lecShort(f.lecture) : "")) + "</span>" +
    (isNew(f) ? '<span class="tag Submitted">New</span>' : "") + (vs.length ? "<span>" + (vs.length + 1) + " versions</span>" : "") + (cur === "dups" && dupOf[f.id] ? '<span class="tag Todo">' + dupOf[f.id] + " copies</span>" : "") + tags.map(function (t) { return '<span class="tag ' + t + '">' + t + "</span>"; }).join("");
  var more = "";
  if (open[f.id]) {
    more = '<div class="more"><div class="chips">' + TAGS.map(function (t) { return '<button type="button" data-act="tag" data-id="' + esc(f.id) + '" data-tag="' + t + '" aria-pressed="' + (tags.indexOf(t) >= 0) + '">' + t + "</button>"; }).join("") + "</div>" +
      '<label class="hint" style="display:flex;gap:6px;align-items:center">Lecture <select data-act="setLec" data-id="' + esc(f.id) + '" style="width:auto"><option value="">None</option>' + LECTURE_NAMES.map(function (n) { return "<option" + (f.lecture === n ? " selected" : "") + ' value="' + esc(n) + '">' + esc(lecShort(n)) + "</option>"; }).join("") + "</select></label>" +
      '<form class="inline" data-act="noteForm" data-id="' + esc(f.id) + '"><input type="text" maxlength="200" placeholder="Add a note, e.g. needs references" value="' + esc(f.note || "") + '" aria-label="Note"><button class="btn alt" type="submit">Save note</button></form>' +
      '<div><button class="link" type="button" data-act="replace" data-id="' + esc(f.id) + '">Upload a newer version</button> <button class="link" type="button" data-act="share" data-id="' + esc(f.id) + '">Make a share link (' + SHARE_HOURS + ' hours)</button></div>' +
      (shareOut[f.id] ? '<div class="sharebox">' + shareOut[f.id] + "</div>" : "") +
      (f.rel ? '<div class="hint">From: ' + esc(f.rel) + "</div>" : "") +
      (vs.length ? '<div><b>Older versions</b></div>' + vs.slice().reverse().map(function (v) {
        return '<div class="vrow"><span>' + fmtDate(v.at || 0) + " · " + fmtSize(v.size || 0) + '</span><span><button class="link" type="button" data-act="vdl" data-id="' + esc(f.id) + '" data-path="' + esc(v.path) + '">Download</button> <button class="link" type="button" data-act="vrestore" data-id="' + esc(f.id) + '" data-path="' + esc(v.path) + '">Make current</button></span></div>';
      }).join("") : '<div class="hint">No older versions yet.</div>') + "</div>";
  }
  return '<div class="file' + (sel[f.id] ? " sel" : "") + '"><input type="checkbox" data-act="sel" data-id="' + esc(f.id) + '"' + (sel[f.id] ? " checked" : "") + ' aria-label="Select ' + esc(f.name) + '"><div class="ext">' + esc(ext.slice(0, 4) || "file") + "</div><div>" +
    (isEd ? '<form class="inline" data-act="renameForm" data-id="' + esc(f.id) + '"><input type="text" id="renameIn" value="' + esc(f.name) + '" maxlength="140"><button class="btn" type="submit">Save</button><button class="btn alt" type="button" data-act="renameCancel">Cancel</button></form>' : '<div class="fn">' + esc(f.name) + "</div>") +
    '<div class="meta">' + meta + "</div>" + (f.note && !open[f.id] ? '<div class="notef">' + esc(f.note) + "</div>" : "") +
    '<div class="acts"><button class="link" type="button" data-act="dl" data-id="' + esc(f.id) + '">Download</button>' +
    (PREVIEW[ext] ? '<button class="link" type="button" data-act="preview" data-id="' + esc(f.id) + '">Preview</button>' : "") +
    '<button class="link" type="button" data-act="today" data-id="' + esc(f.id) + '">' + (f.today === londonParts().date ? "Not today" : "For today") + "</button>" +
    '<button class="link" type="button" data-act="rename" data-id="' + esc(f.id) + '">Rename</button>' +
    '<button class="link" type="button" data-act="more" data-id="' + esc(f.id) + '" aria-expanded="' + !!open[f.id] + '">' + (open[f.id] ? "Less" : "More") + "</button>" +
    '<button class="link warn' + (rmOn ? " sure" : "") + '" type="button" data-act="rm" data-id="' + esc(f.id) + '">' + (rmOn ? "Tap again to bin" : "Delete") + "</button></div>" + more + "</div></div>";
}
function binRow(f) {
  var rmOn = sure === "gone:" + f.id, left = Math.max(0, Math.ceil((f.deletedAt + BIN_DAYS * DAY - Date.now()) / DAY));
  return '<div class="file" style="grid-template-columns:40px 1fr"><div class="ext">' + esc(extOf(f.name).slice(0, 4) || "file") + '</div><div><div class="fn">' + esc(f.name) + '</div><div class="meta"><span>' + fmtSize(f.size || 0) + "</span><span>From " + esc(folderName(f.folder)) + "</span><span>Gone in " + left + (left === 1 ? " day" : " days") + '</span></div><div class="acts"><button class="link" type="button" data-act="restore" data-id="' + esc(f.id) + '">Restore</button><button class="link warn' + (rmOn ? " sure" : "") + '" type="button" data-act="gone" data-id="' + esc(f.id) + '">' + (rmOn ? "Tap again: delete forever" : "Delete forever") + "</button></div></div></div>";
}

/* ---------- clicks ---------- */
function arm(key) { sure = key; clearTimeout(sureTimer); sureTimer = setTimeout(function () { sure = null; render(); }, 4000); render(); }
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-act]"); if (!b || b.tagName === "FORM") return;
  var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
  if (act === "cur") { cur = id; sel = {}; render(); return; }
  if (act === "sel") { sel[id] = b.checked; render(); return; }
  if (act === "renameCancel") { editing = null; render(); return; }
  if (act === "rename") { editing = id; render(); return; }
  if (act === "fRename") { editing = "fo:" + id; render(); return; }
  if (act === "more") { open[id] = !open[id]; render(); return; }
  if (act === "dl") { var f = byId(id); if (f) download(f.path, f.name); return; }
  if (act === "vdl") { var fv = byId(id); if (fv) download(b.getAttribute("data-path"), "Older - " + fv.name); return; }
  if (act === "vrestore") { restoreVersion(id, b.getAttribute("data-path")); return; }
  if (act === "preview") { preview(id); return; }
  if (act === "replace") { replaceId = id; $("replaceInput").click(); return; }
  if (act === "today") { var tf0 = byId(id), td = londonParts().date; if (tf0) updateDoc(doc(filecol(), id), { today: tf0.today === td ? "" : td }).catch(fail("set aside")); return; }
  if (act === "share") { makeShare(id); return; }
  if (act === "copy") { copyText(b.getAttribute("data-url"), b); return; }
  if (act === "tag") { toggleTag(id, b.getAttribute("data-tag")); return; }
  if (act === "restore") { updateDoc(doc(filecol(), id), { deletedAt: null }).catch(fail("restore")); return; }
  if (act === "rm") { if (sure !== "rm:" + id) return arm("rm:" + id); sure = null; updateDoc(doc(filecol(), id), { deletedAt: Date.now() }).catch(fail("bin")); return; }
  if (act === "gone") { if (sure !== "gone:" + id) return arm("gone:" + id); sure = null; var g = byId(id); if (g) hardDelete(g); return; }
  if (act === "fRm") { if (sure !== "fo:" + id) return arm("fo:" + id); sure = null; removeFolder(id); return; }
});
function fail(what) { return function (e) { note("Couldn't " + what + ": " + (e.code || e.message)); }; }

function download(path, name) {
  getDownloadURL(ref(storage, path)).then(function (url) {
    var a = document.createElement("a"); a.href = url; a.download = name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  }).catch(fail("download"));
}
var foldersLoaded = false, filesLoaded = false, tidied = false;
function maybeTidy() { if (foldersLoaded && filesLoaded && !tidied) { tidied = true; removeUnitFolders().then(sortByLevel).then(clearAllOnce).then(tidyFoldersOnce).then(function () { return getDoc(doc(db, "users", uid, "meta", "lectures1")).then(function (s) { if (!s.exists()) return setDoc(doc(db, "users", uid, "meta", "lectures1"), { at: Date.now(), skipped: true }); }); }); } }
/* One-off: put files into Level 2 and Level 3. A file that came from a folder named "Level 2" or "Level 3" goes there;
   otherwise it goes by the year the file was last changed: 2025 or earlier is Level 2, 2026 onwards is Level 3. Uses the file's own date from your computer, not the upload date.
   Folders left empty afterwards are removed, except Home. Files in Home and in the bin are left alone. */
var LEVEL_CUTOFF = Date.UTC(2026, 0, 1);
function sortByLevel() {
  var flag = doc(db, "users", uid, "meta", "levels2");
  return getDoc(flag).then(function (s) {
    if (s.exists()) return;
    var homeIds = folders.filter(function (f) { return String(f.name).toLowerCase() === "home"; }).map(function (f) { return f.id; });
    return Promise.all([ensureFolder("Level 3"), ensureFolder("Level 2")]).then(function (ids) {
      var l3 = ids[0], l2 = ids[1], b = writeBatch(db), used = {}, moved = 0;
      b.update(doc(fcol(), l3), { order: -2 }); b.update(doc(fcol(), l2), { order: -1 });
      files.forEach(function (f) {
        if (f.deletedAt || homeIds.indexOf(f.folder) >= 0) { used[f.folder] = 1; return; }
        var hint = (String(f.rel || "") + " " + folderName(f.folder)).toLowerCase(), when = f.srcModified || f.createdAt || Date.now();
        var to = /level\s*3/.test(hint) ? l3 : /level\s*2/.test(hint) ? l2 : (when < LEVEL_CUTOFF ? l2 : l3);
        if (f.folder !== to) { b.update(doc(filecol(), f.id), { folder: to }); moved++; }
        used[to] = 1;
      });
      folders.forEach(function (fo) {
        if (fo.id !== l2 && fo.id !== l3 && homeIds.indexOf(fo.id) < 0 && !used[fo.id]) b.delete(doc(fcol(), fo.id));
      });
      b.set(flag, { at: Date.now(), moved: moved });
      return b.commit();
    });
  }).catch(function (e) { note("Couldn't sort into levels: " + (e.code || e.message)); });
}
/* One-off tidy-up: remove the lecture-name folders that were added at setup. Their files move to Inbox; nothing is deleted. */
function removeUnitFolders() {
  var flag = doc(db, "users", uid, "meta", "cleanup1");
  return getDoc(flag).then(function (s) {
    if (s.exists()) return;
    var names = DEFAULT_FOLDERS.filter(function (n) { return n !== "Home"; }).map(function (n) { return n.toLowerCase(); });
    var gone = folders.filter(function (f) { return names.indexOf(String(f.name).toLowerCase()) >= 0; }).map(function (f) { return f.id; });
    var b = writeBatch(db);
    files.forEach(function (f) { if (gone.indexOf(f.folder) >= 0) b.update(doc(filecol(), f.id), { folder: "inbox" }); });
    gone.forEach(function (id) { b.delete(doc(fcol(), id)); });
    b.set(flag, { at: Date.now(), removed: gone.length });
    return b.commit();
  }).catch(function (e) { note("Couldn't tidy folders: " + (e.code || e.message)); });
}
function deletePaths(paths) {
  return Promise.all(paths.map(function (p) { return deleteObject(ref(storage, p)).catch(function (e) { if (e.code !== "storage/object-not-found") throw e; }); }));
}
function hardDelete(f) { return deletePaths(allPaths(f)).then(function () { return deleteDoc(doc(filecol(), f.id)); }).catch(fail("delete")); }
function purgeBin() {
  var cut = Date.now() - BIN_DAYS * DAY;
  files.forEach(function (f) { if (f.deletedAt && f.deletedAt < cut) hardDelete(f); });
}
$("emptyBin").addEventListener("click", function () {
  if (sure !== "empty") return arm("empty");
  sure = null;
  files.filter(function (f) { return f.deletedAt; }).forEach(hardDelete);
});
function removeFolder(id) {
  var b = writeBatch(db);
  files.forEach(function (f) { if (f.folder === id) b.update(doc(filecol(), f.id), { folder: "inbox" }); });
  b.delete(doc(fcol(), id));
  if (cur === id) cur = "all";
  b.commit().catch(fail("delete the folder"));
}
function toggleTag(id, t) {
  var f = byId(id); if (!f) return;
  var tags = (f.tags || []).slice(), i = tags.indexOf(t);
  if (i >= 0) tags.splice(i, 1); else tags.push(t);
  updateDoc(doc(filecol(), id), { tags: tags }).catch(fail("tag"));
}
function restoreVersion(id, path) {
  var f = byId(id); if (!f) return;
  var vs = (f.versions || []).slice(), v = null;
  vs = vs.filter(function (x) { if (x.path === path) { v = x; return false; } return true; });
  if (!v) return;
  vs.push({ path: f.path, size: f.size || 0, at: changedAt(f) });
  updateDoc(doc(filecol(), id), { path: v.path, size: v.size || 0, versions: vs, updatedAt: Date.now() }).catch(fail("restore that version"));
}

document.addEventListener("submit", function (e) {
  var f = e.target;
  if (f.id === "folderForm") {
    e.preventDefault();
    var n = $("folderName").value.trim(); if (!n) return;
    ensureFolder(n).then(function () { $("folderName").value = ""; }).catch(fail("add the folder"));
    return;
  }
  var act = f.getAttribute("data-act"), id = f.getAttribute("data-id");
  if (act === "renameForm") {
    e.preventDefault();
    var rec = byId(id); if (!rec) return;
    var name = $("renameIn").value.trim(); if (!name) return;
    var oe = rec.name.lastIndexOf("."); if (name.indexOf(".") < 0 && oe > 0) name += rec.name.slice(oe);
    editing = null;
    updateMetadata(ref(storage, rec.path), { contentDisposition: dispo(name) }).catch(function () {})
      .then(function () { return updateDoc(doc(filecol(), id), { name: name }); })
      .catch(fail("rename")).then(render);
  }
  if (act === "fRenameForm") {
    e.preventDefault();
    var nn = $("renameIn").value.trim(); if (!nn) return;
    editing = null;
    updateDoc(doc(fcol(), id), { name: nn }).catch(fail("rename the folder")).then(render);
  }
  if (act === "noteForm") {
    e.preventDefault();
    var inp = f.querySelector("input"), txt = inp.value.trim();
    inp.blur();
    updateDoc(doc(filecol(), id), { note: txt }).catch(fail("save the note"));
  }
});

$("bulkMove").addEventListener("click", function () {
  var to = $("bulkTo").value, b = writeBatch(db);
  Object.keys(sel).forEach(function (k) { b.update(doc(filecol(), k), { folder: to }); });
  sel = {};
  b.commit().catch(fail("move"));
});
$("bulkBin").addEventListener("click", function () {
  var b = writeBatch(db), t = Date.now();
  Object.keys(sel).forEach(function (k) { b.update(doc(filecol(), k), { deletedAt: t }); });
  sel = {};
  b.commit().catch(fail("bin"));
});
$("bulkClear").addEventListener("click", function () { sel = {}; render(); });
$("q").addEventListener("input", render);
$("sort").addEventListener("change", render);
$("tagF").addEventListener("change", render);

/* ---------- share links ----------
   A copy goes to share/<you>/<id>/<name> with an expiry time. The storage rules let anyone with the link download it
   until then, and nobody but you after. Expired copies are deleted next time you open the app. */
var shareOut = {};
function shareCol() { return collection(db, "users", uid, "shares"); }
function makeShare(id) {
  var f = byId(id); if (!f) return;
  shareOut[id] = '<span class="hint">Making a link...</span>'; render();
  var sid = newId(), exp = Date.now() + SHARE_HOURS * 3600000, path = "share/" + uid + "/" + sid + "/" + safeName(f.name);
  getBlob(ref(storage, f.path)).then(function (blob) {
    return uploadBytes(ref(storage, path), blob, { contentType: f.type || blob.type || "application/octet-stream", contentDisposition: dispo(f.name), customMetadata: { exp: String(exp) } });
  }).then(function () {
    return setDoc(doc(shareCol(), sid), { path: path, exp: exp, file: id, name: f.name });
  }).then(function () {
    var url = "https://firebasestorage.googleapis.com/v0/b/" + firebaseConfig.storageBucket + "/o/" + encodeURIComponent(path) + "?alt=media";
    shareOut[id] = '<div class="hint">Anyone with this link can download it until ' + esc(fmtDate(exp)) + ':</div><div class="inline"><input type="text" readonly value="' + esc(url) + '" aria-label="Share link"><button class="btn alt" type="button" data-act="copy" data-url="' + esc(url) + '">Copy</button></div>';
    render();
  }).catch(function (e) {
    shareOut[id] = '<span class="hint">Couldn\'t make a link (' + esc(e.code || e.message) + ').</span>'; render();
  });
}
function copyText(text, btn) {
  var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 2000); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
}
function cleanShares() {
  getDocs(shareCol()).then(function (snap) {
    var now = Date.now();
    snap.docs.forEach(function (d) {
      var x = d.data();
      if (x.exp && x.exp < now) deleteObject(ref(storage, x.path)).catch(function () {}).then(function () { return deleteDoc(doc(shareCol(), d.id)); }).catch(function () {});
    });
  }).catch(function () {});
}

/* ---------- preview ---------- */
var objUrl = null, previewing = null;
function closePreview() { $("modal").hidden = true; $("mBody").innerHTML = ""; if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; } previewing = null; }
$("mClose").addEventListener("click", closePreview);
$("mDl").addEventListener("click", function () { var f = byId(previewing); if (f) download(f.path, f.name); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closePreview(); });
function preview(id) {
  var f = byId(id); if (!f) return;
  var kind = PREVIEW[extOf(f.name)];
  previewing = id;
  $("mTitle").textContent = f.name;
  $("mBody").innerHTML = '<div class="hint">Loading...</div>';
  $("modal").hidden = false;
  getBlob(ref(storage, f.path)).then(function (blob) {
    if (previewing !== id) return;
    if (kind === "docx") return loadScript("lib/mammoth.browser.min.js", "mammoth").then(function (m) { return blob.arrayBuffer().then(function (buf) { return m.convertToHtml({ arrayBuffer: buf }); }); }).then(function (r) {
      if (previewing !== id) return;
      var fr = document.createElement("iframe");
      fr.setAttribute("sandbox", ""); fr.title = f.name;
      fr.srcdoc = '<!doctype html><meta charset="utf-8"><style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px;color:#141b24;background:#fff}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 6px}</style>' + (r.value || "<p>This document looks empty.</p>");
      $("mBody").innerHTML = ""; $("mBody").appendChild(fr);
    });
    if (kind === "text") return blob.slice(0, 300000).text().then(function (t) { var pre = document.createElement("pre"); pre.textContent = t; $("mBody").innerHTML = ""; $("mBody").appendChild(pre); });
    var typed = new Blob([blob], { type: kind === "pdf" ? "application/pdf" : (blob.type || "image/" + extOf(f.name)) });
    objUrl = URL.createObjectURL(typed);
    $("mBody").innerHTML = kind === "pdf" ? '<iframe title="' + esc(f.name) + '" src="' + objUrl + '"></iframe>' : '<img alt="' + esc(f.name) + '" src="' + objUrl + '">';
  }).catch(function (e) {
    $("mBody").innerHTML = '<div class="hint" style="padding:16px">Couldn\'t load the preview (' + esc(e.code || e.message) + "). If this keeps happening, do step 8 in SETUP.md. You can still use Download.</div>";
  });
}

var scriptLoads = {};
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!scriptLoads[src]) scriptLoads[src] = new Promise(function (res, rej) {
    var s = document.createElement("script"); s.src = src;
    s.onload = function () { res(window[globalName]); }; s.onerror = function () { scriptLoads[src] = null; rej(new Error("couldn't load the viewer")); };
    document.head.appendChild(s);
  });
  return scriptLoads[src];
}

/* ---------- zip a list ---------- */
var jszipLoad = null;
function loadZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipLoad) jszipLoad = new Promise(function (res, rej) {
    var s = document.createElement("script"); s.src = "lib/jszip.min.js";
    s.onload = function () { res(window.JSZip); }; s.onerror = function () { jszipLoad = null; rej(new Error("couldn't load the zip tool")); };
    document.head.appendChild(s);
  });
  return jszipLoad;
}
$("zipBtn").addEventListener("click", function () {
  var label = cur === "all" ? "All files" : cur === "recent" ? "Recent" : cur === "today" ? "For today" : folderName(cur);
  var q = $("q").value.trim().toLowerCase(), tf = $("tagF").value, now = Date.now();
  var list = files.filter(function (f) {
    if (f.deletedAt) return false;
    if (cur === "recent" && now - changedAt(f) >= RECENT_DAYS * DAY) return false;
    if (cur === "today" && f.today !== londonParts().date) return false;
    if (cur === "new" && !isNew(f)) return false;
    if (curLecture() && f.lecture !== curLecture()) return false;
    if (cur !== "all" && cur !== "new" && cur !== "recent" && cur !== "today" && !curLecture() && realFolder(f.folder) !== cur) return false;
    if (tf && (f.tags || []).indexOf(tf) < 0) return false;
    return !q || (f.name + " " + (f.note || "") + " " + (f.tags || []).join(" ") + " " + (f.rel || "")).toLowerCase().indexOf(q) >= 0;
  });
  if (!list.length) return;
  var msg = $("zipMsg"), btn = $("zipBtn"), done = 0, used = {};
  msg.hidden = false; msg.textContent = "Preparing zip... 0 of " + list.length; btn.disabled = true;
  loadZip().then(function (JSZip) {
    var zip = new JSZip();
    var chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () {
        return getBlob(ref(storage, f.path)).then(function (blob) {
          var dir = cur === "all" || cur === "recent" || cur === "today" ? folderName(f.folder) + "/" : "", nm = dir + f.name, n = 2;
          while (used[nm]) { var dot = f.name.lastIndexOf("."); nm = dir + (dot > 0 ? f.name.slice(0, dot) + " (" + n + ")" + f.name.slice(dot) : f.name + " (" + n + ")"); n++; }
          used[nm] = 1; zip.file(nm, blob);
          done++; msg.textContent = "Preparing zip... " + done + " of " + list.length;
        });
      });
    });
    return chain.then(function () { return zip.generateAsync({ type: "blob" }); });
  }).then(function (blob) {
    var a = document.createElement("a"), u = URL.createObjectURL(blob);
    a.href = u; a.download = "Gower Files - " + label.replace(/[\/\\:*?"<>|]/g, "-") + " - " + new Date().toISOString().slice(0, 10) + ".zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
    msg.textContent = "Zip ready: " + list.length + (list.length === 1 ? " file." : " files.");
  }).catch(function (e) {
    msg.textContent = "Couldn't make the zip (" + (e.code || e.message) + "). If this keeps happening, do step 8 in SETUP.md.";
  }).then(function () { btn.disabled = false; });
});

/* ---------- uploads ---------- */
function realTarget() {
  if (cur === "all" || cur === "new" || cur === "recent" || cur === "today" || cur === "bin" || cur === "dups" || curLecture()) {
    var l3 = folders.filter(function (f) { return /level\s*3/i.test(f.name); })[0];
    return l3 ? l3.id : "inbox";
  }
  return cur;
}
/* The lecture new uploads are tagged with: the lecture you're looking at, or the one you're in right now. */
function targetLecture() { return curLecture() || lectureNow() || "";
}
$("autoFile").addEventListener("change", function (e) { autoFile = e.target.checked; try { localStorage.setItem("gf-autofile", autoFile ? "on" : "off"); } catch (er) {} render(); });
var folderMade = {};
function ensureFolder(name) {
  var key = name.trim().toLowerCase();
  for (var i = 0; i < folders.length; i++) if (String(folders[i].name).trim().toLowerCase() === key) return Promise.resolve(folders[i].id);
  if (!folderMade[key]) {
    var r = doc(fcol()), order = folders.reduce(function (m, x) { return Math.max(m, x.order || 0); }, 0) + 1 + Object.keys(folderMade).length;
    folderMade[key] = setDoc(r, { name: name.trim(), order: order }).then(function () { return r.id; });
  }
  return folderMade[key];
}
/* A whole folder: the first level of subfolders becomes folders here (e.g. "Level 3 Esports/Neil/x.docx" goes in "Neil").
   Files sitting directly in the chosen folder go in a folder named after it. */
/* Uploading a whole folder (like Level 3 Esports): every file goes into Level 2 or Level 3, and Level 3 files
   go into their lecture. The college folder is laid out as <Lecturer> Esports/..., with last year's work in
   subfolders called "Esports 2" or "Esports level 2", so:
   - a "level 2" / "Esports 2" folder anywhere in the path -> Level 2
   - otherwise Level 3, in the lecture that lecturer teaches (Kiran's coaching files go to Esports Coaching)
   - no lecturer folder: the unit number in the name (Unit 1-4), then words in the name, decide the lecture. */
var LECTURER_LECTURE = { clive: "Enterprise & Entrepreneurship in Esports", kiran: "Introduction to Esports", leah: "Video Production", leigh: "Games Design", neil: "Esports Skills, Strategies and Analysis", sian: "Health, Wellbeing and Fitness for Esports Players", bernice: "ASBW", vicky: "GCSE Maths" };
var UNIT_LECTURE = { 1: "Introduction to Esports", 2: "Esports Skills, Strategies and Analysis", 3: "Enterprise & Entrepreneurship in Esports", 4: "Health, Wellbeing and Fitness for Esports Players" };
function classifyRel(rel) {
  var parts = rel.split("/"), name = parts[parts.length - 1], dirs = parts.slice(0, -1);
  var level2 = dirs.some(function (d) { return /^esports\s*2$|level\s*2|esports\s*level\s*2/i.test(d.trim()); });
  if (level2) return { level: 2, lecture: "" };
  var lec = "";
  dirs.forEach(function (d) { var k = d.trim().split(/\s+/)[0].toLowerCase(); if (!lec && LECTURER_LECTURE[k]) lec = LECTURER_LECTURE[k]; });
  if (lec === "Introduction to Esports" && /coach/i.test(name)) lec = "Esports Coaching";
  if (!lec) { var u = /unit[\s_-]*(\d+)/i.exec(name); if (u && UNIT_LECTURE[+u[1]]) lec = UNIT_LECTURE[+u[1]]; }
  if (!lec) lec = lectureScore(name.replace(/[_\-.]+/g, " "));
  return { level: 3, lecture: lec };
}
function folderFor(rel) {
  var c = classifyRel(rel);
  return ensureFolder(c.level === 2 ? "Level 2" : "Level 3").then(function (id) { return { folder: id, lecture: c.lecture }; });
}

$("pick").addEventListener("click", function () { $("fileInput").click(); });
$("pickDir").addEventListener("click", function () { $("dirInput").click(); });
$("fileInput").addEventListener("change", function (e) { queue(Array.prototype.map.call(e.target.files, function (f) { return { file: f, rel: "" }; })); e.target.value = ""; });
$("dirInput").addEventListener("change", function (e) { queue(Array.prototype.map.call(e.target.files, function (f) { return { file: f, rel: f.webkitRelativePath || "" }; })); e.target.value = ""; });
$("replaceInput").addEventListener("change", function (e) {
  var file = e.target.files[0], f = byId(replaceId); e.target.value = "";
  if (file && f) sendVersion(f, file);
});

var drop = $("drop");
["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
drop.addEventListener("drop", function (e) {
  var items = e.dataTransfer.items, entries = [];
  if (items && items.length && items[0].webkitGetAsEntry) {
    for (var i = 0; i < items.length; i++) { var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry(); if (en) entries.push(en); }
  }
  if (entries.some(function (en) { return en.isDirectory; })) {
    Promise.all(entries.map(function (en) { return walk(en, ""); })).then(function (lists) { queue([].concat.apply([], lists)); });
  } else {
    queue(Array.prototype.map.call(e.dataTransfer.files, function (f) { return { file: f, rel: "" }; }));
  }
});
window.addEventListener("dragover", function (e) { e.preventDefault(); });
window.addEventListener("drop", function (e) { e.preventDefault(); });
function walk(entry, prefix) {
  var path = prefix ? prefix + "/" + entry.name : entry.name;
  if (entry.isFile) return new Promise(function (res) { entry.file(function (f) { res([{ file: f, rel: path.indexOf("/") >= 0 ? path : "" }]); }, function () { res([]); }); });
  return new Promise(function (res) {
    var reader = entry.createReader(), all = [];
    (function more() {
      reader.readEntries(function (batch) {
        if (!batch.length) return Promise.all(all.map(function (c) { return walk(c, path); })).then(function (l) { res([].concat.apply([], l)); });
        all = all.concat(Array.prototype.slice.call(batch)); more();
      }, function () { res([]); });
    })();
  });
}

/* Uploads run three at a time so a big folder doesn't stall the page. */
var waiting = [], running = 0;
function queue(items) {
  if (!uid) return;
  var skipped = 0;
  items.forEach(function (it) {
    if (JUNK.test(it.file.name)) { skipped++; return; }
    var row = document.createElement("div"); row.className = "up";
    row.innerHTML = "<span>" + esc(it.rel || it.file.name) + ' <span class="pc">waiting</span></span><div class="bar"><span></span></div>';
    $("ups").appendChild(row);
    it.row = row; it.target = realTarget(); it.lecture = targetLecture();
    waiting.push(it);
  });
  if (skipped) note(skipped + " temporary or system file" + (skipped === 1 ? " was" : "s were") + " skipped.");
  pump();
}
function pump() {
  while (running < 3 && waiting.length) {
    running++;
    (function (it) {
      (it.rel ? folderFor(it.rel) : Promise.resolve({ folder: it.target, lecture: it.lecture })).then(function (dest) {
        var folder = dest.folder; it.lecture = dest.lecture;
        /* Same file again: matched by its path inside the uploaded folder, or by name and folder for single files. */
        var existing = files.filter(function (f) { return !f.deletedAt && (it.rel ? f.rel === it.rel : (f.name === it.file.name && realFolder(f.folder) === realFolder(folder))); })[0];
        if (existing && existing.size === it.file.size && existing.srcModified === it.file.lastModified) {
          it.row.querySelector(".pc").textContent = "already up to date";
          setTimeout(function () { it.row.remove(); }, 2500);
          return;
        }
        return existing ? sendVersion(existing, it.file, it.row) : sendNew(it.file, folder, it.rel, it.row, it.lecture);
      }).catch(function (er) { it.row.classList.add("err"); it.row.textContent = it.file.name + ": " + (er.code || er.message); })
        .then(function () { running--; pump(); });
    })(waiting.shift());
  }
}
function put(path, file, name, row) {
  return new Promise(function (res, rej) {
    var task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type || "application/octet-stream", contentDisposition: dispo(name) });
    task.on("state_changed", function (s) {
      var p = s.totalBytes ? Math.round(s.bytesTransferred / s.totalBytes * 100) : 0;
      if (row) { row.querySelector(".pc").textContent = p + "%"; row.querySelector(".bar span").style.width = p + "%"; }
    }, rej, res);
  });
}
function fingerprint(file) {
  try {
    if (!window.crypto || !crypto.subtle || file.size > 60 * 1048576) return Promise.resolve("");
    return file.arrayBuffer().then(function (b) { return crypto.subtle.digest("SHA-256", b); }).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    }).catch(function () { return ""; });
  } catch (e) { return Promise.resolve(""); }
}
function sendNew(file, folder, rel, row, lecture) {
  var id = newId(), path = "users/" + uid + "/files/" + id + "/" + safeName(file.name), hash = "";
  return fingerprint(file).then(function (h) { hash = h; return put(path, file, file.name, row); }).then(function () {
    return setDoc(doc(filecol(), id), { name: file.name, folder: folder, size: file.size, type: file.type || "", path: path, createdAt: Date.now(), srcModified: file.lastModified || 0, rel: rel || "", tags: [], note: "", hash: hash, lecture: lecture || "", by: DEVICE });
  }).then(function () { if (row) row.remove(); });
}
function sendVersion(f, file, row) {
  if (!row) {
    row = document.createElement("div"); row.className = "up";
    row.innerHTML = "<span>New version of " + esc(f.name) + ' <span class="pc">0%</span></span><div class="bar"><span></span></div>';
    $("ups").appendChild(row);
  } else row.querySelector("span").firstChild.textContent = "New version of " + f.name + " ";
  var path = "users/" + uid + "/files/" + f.id + "/v" + Date.now().toString(36) + "/" + safeName(f.name);
  var hash = "";
  return fingerprint(file).then(function (h) { hash = h; return put(path, file, f.name, row); }).then(function () {
    var vs = (f.versions || []).concat([{ path: f.path, size: f.size || 0, at: changedAt(f) }]), drop = [];
    while (vs.length > MAX_VERSIONS) drop.push(vs.shift().path);
    return updateDoc(doc(filecol(), f.id), { path: path, size: file.size, updatedAt: Date.now(), srcModified: file.lastModified || 0, versions: vs, hash: hash, by: DEVICE }).then(function () { return deletePaths(drop); });
  }).then(function () { row.remove(); }, function (er) { row.classList.add("err"); row.textContent = f.name + ": upload failed (" + (er.code || er.message) + ")"; throw er; });
}

document.addEventListener("change", function (e) {
  var s = e.target;
  if (s && s.getAttribute && s.getAttribute("data-act") === "setLec") updateDoc(doc(filecol(), s.getAttribute("data-id")), { lecture: s.value }).catch(fail("set the lecture"));
});
$("bulkLec").addEventListener("click", function () {
  var v = $("bulkLecTo").value, b = writeBatch(db);
  var l3 = level3Id();
  Object.keys(sel).forEach(function (k) { var up = { lecture: v === "-" ? "" : v }; if (v !== "-" && l3) up.folder = l3; b.update(doc(filecol(), k), up); });
  sel = {};
  b.commit().catch(fail("set the lecture"));
});

/* ---------- sort Level 3 files into lecture folders ----------
   Looks at each file's name, the folder it came from, its note and (for Word files) the first part of its text,
   and scores it against words for each lecture. Files with a clear winner go into that lecture; the rest stay
   loose in Level 3 so you can move them by hand. It never moves a file you've already put in a lecture. */
var LECTURE_WORDS = {
  "Esports Skills, Strategies and Analysis": ["skills", "strateg", "analys", "tactic", "rocket league", "vod", "replay", "gameplay", "rotation", "team comp", "scrim"],
  "ASBW": ["asbw"],
  "Introduction to Esports": ["introduction to esports", "intro to esports", "esports industry", "history of esports", "esports history", "ecosystem", "stakeholder", "tournament", "publisher", "intro"],
  "Enterprise & Entrepreneurship in Esports": ["enterprise", "entrepreneur", "business plan", "pitch", "marketing", "sponsor", "startup", "start-up", "revenue", "swot", "brand"],
  "Esports Coaching": ["coach", "coaching", "session plan", "player development", "mentor"],
  "Video Production": ["video", "production", "montage", "premiere", "storyboard", "camera", "editing", "footage", "shot list", "filming", "obs studio"],
  "Games Design": ["game design", "games design", "level design", "gdd", "prototype", "mechanic", "game concept", "design document"],
  "Health, Wellbeing and Fitness for Esports Players": ["health", "wellbeing", "well-being", "fitness", "nutrition", "sleep", "exercise", "diet", "posture", "mental health", "hydration"],
  "GCSE Maths": ["math", "maths", "algebra", "fraction", "equation", "percentage", "geometry", "gcse"]
};
function lectureScore(text) {
  text = " " + String(text || "").toLowerCase() + " ";
  var best = "", bestN = 0, second = 0;
  LECTURE_NAMES.forEach(function (l) {
    var n = 0;
    (LECTURE_WORDS[l] || []).forEach(function (w) { var m = text.match(new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")); if (m) n += m.length; });
    if (n > bestN) { second = bestN; bestN = n; best = l; } else if (n > second) second = n;
  });
  return bestN > 0 && bestN > second ? best : "";
}
function docxText(f) {
  if (extOf(f.name) !== "docx" || (f.size || 0) > 15 * 1048576) return Promise.resolve("");
  return loadScript("lib/mammoth.browser.min.js", "mammoth").then(function (m) {
    return getBlob(ref(storage, f.path)).then(function (b) { return b.arrayBuffer(); }).then(function (buf) { return m.extractRawText({ arrayBuffer: buf }); });
  }).then(function (r) { return String((r && r.value) || "").slice(0, 6000); }).catch(function () { return ""; });
}
function sortIntoLectures(showMsg) {
  var l3 = level3Id();
  if (!l3) { if (showMsg) note("There's no Level 3 folder yet."); return Promise.resolve(0); }
  var todo = files.filter(function (f) { return !f.deletedAt && f.folder === l3 && !f.lecture; });
  var picks = {}, chain = Promise.resolve(), done = 0;
  if (showMsg) note("Sorting " + todo.length + " files into lectures...");
  todo.forEach(function (f) {
    chain = chain.then(function () {
      var head = f.name.replace(/[_\-.]+/g, " ") + " " + String(f.rel || "").replace(/level\s*\d\s*esports/ig, "").replace(/[_\-\/]+/g, " ") + " " + (f.note || "");
      var pick = lectureScore(head);
      if (pick) { picks[f.id] = pick; return; }
      return docxText(f).then(function (body) { var p2 = lectureScore(head + " " + body); if (p2) picks[f.id] = p2; });
    });
  });
  return chain.then(function () {
    var ids = Object.keys(picks); if (!ids.length) return 0;
    var b = writeBatch(db);
    ids.forEach(function (id) { b.update(doc(filecol(), id), { lecture: picks[id] }); done++; });
    return b.commit().then(function () { return done; });
  }).then(function (n) {
    if (showMsg) note(n ? n + " of " + todo.length + " files sorted into lecture folders. " + (todo.length - n ? (todo.length - n) + " couldn't be matched and are still loose in Level 3." : "") : "None of the " + todo.length + " loose files could be matched to a lecture.");
    return n;
  });
}
/* One-off (you asked to start again): move every file to the Bin. They stay restorable for 30 days; Empty bin removes them for good. */
function clearAllOnce() {
  var flag = doc(db, "users", uid, "meta", "clear1");
  return getDoc(flag).then(function (s) {
    if (s.exists()) return;
    var t = Date.now(), live = files.filter(function (f) { return !f.deletedAt; }), chain = Promise.resolve();
    for (var i = 0; i < live.length; i += 400) (function (slice) {
      chain = chain.then(function () { var b = writeBatch(db); slice.forEach(function (f) { b.update(doc(filecol(), f.id), { deletedAt: t }); }); return b.commit(); });
    })(live.slice(i, i + 400));
    return chain.then(function () {
      if (live.length) note(live.length + " files moved to the Bin so you can start fresh. Upload your Level 3 Esports folder with \u201cChoose a whole folder\u201d.");
      return setDoc(flag, { at: t, binned: live.length });
    });
  }).catch(function (e) { note("Couldn't clear the files: " + (e.code || e.message)); });
}
/* One-off tidy: remove every empty folder except Level 2 and Level 3 (files in the Bin count as not empty, so nothing is lost). */
function tidyFoldersOnce() {
  var flag = doc(db, "users", uid, "meta", "tidy1");
  return getDoc(flag).then(function (s) {
    if (s.exists()) return;
    var used = {}; files.forEach(function (f) { if (!f.deletedAt) used[f.folder] = 1; });
    var gone = folders.filter(function (f) { return !/^level\s*[23]$/i.test(String(f.name).trim()) && !used[f.id]; });
    var b = writeBatch(db);
    /* Binned files from a removed folder would restore into Inbox. */
    files.forEach(function (f) { if (f.deletedAt && gone.some(function (g) { return g.id === f.folder; })) b.update(doc(filecol(), f.id), { folder: "inbox" }); });
    gone.forEach(function (g) { b.delete(doc(fcol(), g.id)); });
    b.set(flag, { at: Date.now(), removed: gone.length });
    return b.commit();
  }).catch(function (e) { note("Couldn't tidy folders: " + (e.code || e.message)); });
}
function autoSortLectures() {
  var flag = doc(db, "users", uid, "meta", "lectures1");
  return getDoc(flag).then(function (s) {
    if (s.exists()) return;
    return sortIntoLectures(true).then(function (n) { return setDoc(flag, { at: Date.now(), sorted: n }); });
  }).catch(function (e) { note("Couldn't sort into lectures: " + (e.code || e.message)); });
}
$("sortLec").addEventListener("click", function () { sortIntoLectures(true).catch(fail("sort into lectures")); });

/* ---------- auto-save from a folder on this computer ----------
   Chrome and Edge on a computer can give a web page access to one folder. While this tab is open, Gower Files checks that
   folder every 30 seconds (and whenever you come back to the tab) and uploads new and changed files. Changed files are saved
   as a newer version, so nothing is ever overwritten. It never deletes anything, and it only writes to your folder when you
   press "Update this PC". */
var SY = { handle: null, timer: null, busy: false, last: 0, sent: 0, newer: [], target: "" };
function kv(mode, key, val) {
  return new Promise(function (res, rej) {
    var r = indexedDB.open("gower-files", 1);
    r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
    r.onerror = function () { rej(r.error); };
    r.onsuccess = function () {
      var tx = r.result.transaction("kv", mode === "get" ? "readonly" : "readwrite"), st = tx.objectStore("kv");
      var q = mode === "get" ? st.get(key) : mode === "del" ? st.delete(key) : st.put(val, key);
      q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
    };
  });
}
function syncStatus(msg) { $("syncStatus").textContent = msg; }
function renderSync() {
  if (!$("syncBox")) return;
  var ok = typeof window.showDirectoryPicker === "function";
  $("syncBox").hidden = false;
  if (!ok) { $("syncLink").hidden = true; $("syncResume").hidden = true; $("syncStop").hidden = true; syncStatus("Works in Chrome or Edge on a computer."); return; }
  $("syncBox").classList.toggle("on", !!SY.timer);
  $("syncStop").hidden = !SY.handle; $("syncNow").hidden = !SY.timer;
  $("syncLink").textContent = SY.handle ? "Change folder" : "Link a folder";
  $("syncNewer").innerHTML = SY.newer.length ? '<div class="hint">' + SY.newer.length + (SY.newer.length === 1 ? " file is" : " files are") + " newer in Gower Files than on this computer (changed somewhere else): " + SY.newer.slice(0, 5).map(function (n) { return esc(n.rel.split("/").pop()); }).join(", ") + (SY.newer.length > 5 ? "..." : "") + '</div><div><button class="btn alt" type="button" id="syncPull">Update this PC</button></div>' : "";
}
function startTimer() {
  clearInterval(SY.timer);
  SY.timer = setInterval(syncPass, 30000);
  renderSync(); syncPass();
}
function linkFolder() {
  window.showDirectoryPicker({ id: "gower-files", mode: "read" }).then(function (h) {
    SY.handle = h; SY.newer = [];
    return kv("put", "handle", h).catch(function () {}).then(startTimer);
  }).catch(function (e) { if (e && e.name !== "AbortError") syncStatus("Couldn't link the folder (" + (e.message || e.name) + ")."); });
}
function resume() {
  if (!SY.handle) return;
  SY.handle.requestPermission({ mode: "read" }).then(function (p) {
    if (p === "granted") { $("syncResume").hidden = true; startTimer(); } else syncStatus("Allow access to keep auto-saving.");
  }).catch(function () { syncStatus("Allow access to keep auto-saving."); });
}
function stopSync() {
  clearInterval(SY.timer); SY.timer = null; SY.handle = null; SY.newer = [];
  kv("del", "handle").catch(function () {});
  $("syncResume").hidden = true; syncStatus("Auto-save is off."); renderSync();
}
function walkDir(dir, prefix, out) {
  var it = dir.values(), step = function () {
    return it.next().then(function (r) {
      if (r.done) return out;
      var h = r.value, p = prefix + "/" + h.name;
      if (h.kind === "directory") return walkDir(h, p, out).then(step);
      if (!JUNK.test(h.name)) out.push({ rel: p, fh: h });
      return step();
    });
  };
  return step();
}
function syncPass() {
  if (!SY.handle || SY.busy || !uid) return;
  SY.busy = true;
  var root = SY.handle.name, mapKey = "map:" + root, map = {}, sent = 0;
  SY.handle.queryPermission({ mode: "read" }).then(function (p) {
    if (p !== "granted") { clearInterval(SY.timer); SY.timer = null; $("syncResume").hidden = false; syncStatus("Paused. Press Resume to carry on auto-saving " + root + "."); throw "stop"; }
    syncStatus("Checking " + root + "...");
    return kv("get", mapKey).catch(function () { return null; });
  }).then(function (m) {
    map = m || {};
    return walkDir(SY.handle, root, []);
  }).then(function (entries) {
    var byRel = {}; files.forEach(function (f) { if (!f.deletedAt && f.rel) byRel[f.rel] = f; });
    var newer = [], chain = Promise.resolve(), localRels = {}, renamed = 0;
    entries.forEach(function (en) { localRels[en.rel] = 1; });
    SY.errors = []; SY.saved = [];
    entries.forEach(function (en) {
      chain = chain.then(function () { return en.fh.getFile(); }).then(function (file) {
        var rec = byRel[en.rel], seen = map[en.rel];
        if (file.size > 100 * 1048576) return;
        if (!rec) {
          /* Renamed or moved on the computer? A file in Gower Files with the same size and date whose old path is
             gone from the folder is the same file: rename it there instead of uploading a copy. */
          var moved = files.filter(function (f) { return !f.deletedAt && f.rel && !localRels[f.rel] && f.size === file.size && f.srcModified === file.lastModified && String(f.rel).split("/")[0] === root; })[0];
          if (moved) {
            var nm = en.rel.split("/").pop(); moved.rel = en.rel; moved.name = nm; byRel[en.rel] = moved;
            return Promise.resolve().then(function () { return updateMetadata(ref(storage, moved.path), { contentDisposition: dispo(nm) }); }).catch(function () {})
              .then(function () { return updateDoc(doc(filecol(), moved.id), { rel: en.rel, name: nm }); })
              .then(function () { map[en.rel] = { lm: file.lastModified }; renamed++; });
          }
          sent++; var where = ""; return folderFor(en.rel).then(function (dest) { where = (classifyRel(en.rel).level === 2 ? "Level 2" : "Level 3") + (dest.lecture ? " › " + dest.lecture : ""); return sendNew(file, dest.folder, en.rel, null, dest.lecture); }).then(function () { map[en.rel] = { lm: file.lastModified }; SY.saved.push({ name: file.name, where: where }); });
        }
        var src = rec.srcModified || 0;
        /* Changed here since the last check (or, the first time, newer here than in Gower Files): upload it as a new version. */
        var localChanged = seen ? file.lastModified !== seen.lm : (file.lastModified > src || (file.lastModified === src && file.size !== rec.size));
        if (localChanged) { sent++; return sendVersion(rec, file, null).then(function () { map[en.rel] = { lm: file.lastModified }; SY.saved.push({ name: file.name, where: "new version" }); }); }
        map[en.rel] = { lm: file.lastModified };
        if (src > file.lastModified) newer.push({ rel: en.rel, fh: en.fh, rec: rec });
      }, function (e) { /* open in Word or unreadable right now: try again next time, but say so */ SY.errors.push(en.rel.split("/").pop() + " (can't be read: " + ((e && (e.name || e.message)) || "locked") + ")"); })
        /* One file failing must not stop the rest: note it and carry on. */
        .catch(function (e) { sent = Math.max(0, sent - 1); SY.errors.push(en.rel.split("/").pop() + " (" + ((e && (e.code || e.message)) || e) + ")"); });
    });
    return chain.then(function () {
      SY.newer = newer;
      var live = files.filter(function (f) { return !f.deletedAt && f.rel && String(f.rel).split("/")[0] === root; });
      var stale = live.filter(function (f) { return !localRels[f.rel] && live.some(function (g) { return g !== f && localRels[g.rel] && g.size === f.size && g.srcModified === f.srcModified; }); });
      if (!stale.length) return;
      var b = writeBatch(db), tm = Date.now();
      stale.forEach(function (f) { b.update(doc(filecol(), f.id), { deletedAt: tm }); });
      return b.commit().then(function () { renamed += stale.length; });
    }).then(function () { SY.renamed = renamed; });
  }).then(function () {
    SY.last = Date.now(); SY.sent += sent;
    if (SY.saved && SY.saved.length) notifySaved(SY.saved);
    return kv("put", mapKey, map).catch(function () {});
  }).then(function () {
    syncStatus("Auto-saving " + root + " · checked " + fmtDate(SY.last).split(", ").pop() + (SY.sent ? " · " + SY.sent + " saved this session" : "") + (SY.renamed ? " · " + SY.renamed + " renamed to match" : "") + (SY.errors.length ? " · " + SY.errors.length + " couldn't upload: " + SY.errors.slice(0, 4).join(", ") + (SY.errors.length > 4 ? "..." : "") : ""));
  }, function (e) { if (e !== "stop") syncStatus("Auto-save hit a problem (" + ((e && (e.code || e.message)) || e) + "). It will try again."); })
    .then(function () { SY.busy = false; renderSync(); });
}
function pullNewer() {
  if (!SY.handle || !SY.newer.length) return;
  var list = SY.newer.slice(), root = SY.handle.name, mapKey = "map:" + root, done = 0;
  SY.handle.requestPermission({ mode: "readwrite" }).then(function (p) {
    if (p !== "granted") throw new Error("not allowed to write to the folder");
    return kv("get", mapKey).catch(function () { return null; });
  }).then(function (m) {
    var map = m || {}, chain = Promise.resolve();
    list.forEach(function (n) {
      chain = chain.then(function () { return getBlob(ref(storage, n.rec.path)); }).then(function (blob) {
        return n.fh.createWritable().then(function (w) { return w.write(blob).then(function () { return w.close(); }); });
      }).then(function () { return n.fh.getFile(); }).then(function (f) { map[n.rel] = { lm: f.lastModified }; done++; }, function () {});
    });
    return chain.then(function () { return kv("put", mapKey, map).catch(function () {}); });
  }).then(function () {
    SY.newer = []; syncStatus("Updated " + done + (done === 1 ? " file" : " files") + " on this computer" + (done < list.length ? " (close any open in Word and try again for the rest)" : "") + ".");
    renderSync();
  }).catch(function (e) { syncStatus("Couldn't update this PC (" + (e.code || e.message) + ")."); });
}
$("syncLink").addEventListener("click", linkFolder);
$("syncResume").addEventListener("click", resume);
$("syncStop").addEventListener("click", stopSync);
document.addEventListener("click", function (e) { if (e.target && e.target.id === "syncPull") pullNewer(); });
document.addEventListener("visibilitychange", function () { if (!document.hidden && SY.timer) syncPass(); });
window.addEventListener("focus", function () { if (SY.timer) syncPass(); });
/* Pick up a folder linked on an earlier visit. Chrome asks again for permission each visit, so show Resume. */
function initSync() {
  renderSync();
  if (typeof window.showDirectoryPicker !== "function") return;
  kv("get", "handle").then(function (h) {
    if (!h) { syncStatus("Link your college or home folder and changes upload by themselves while this tab is open."); return; }
    SY.handle = h;
    return h.queryPermission({ mode: "read" }).then(function (p) {
      if (p === "granted") startTimer();
      else { $("syncResume").hidden = false; syncStatus("Linked to " + h.name + ". Press Resume to start auto-saving."); renderSync(); }
    });
  }).catch(function () {});
}

$("syncNow").addEventListener("click", function () { syncPass(); });

/* ---------- "Saved" pop-ups: so you don't have to keep checking ---------- */
function toast(title, body) {
  var box = $("toasts"); if (!box) return;
  var t = document.createElement("div"); t.className = "toast";
  t.innerHTML = "<b>" + esc(title) + "</b>" + esc(body);
  box.appendChild(t);
  setTimeout(function () { t.remove(); }, 8000);
}
function notifySaved(list) {
  var title = list.length === 1 ? "Saved to Gower Files" : list.length + " files saved to Gower Files";
  var body = list.slice(0, 4).map(function (s) { return s.name + (s.where ? " → " + s.where : ""); }).join("\n") + (list.length > 4 ? "\n+" + (list.length - 4) + " more" : "");
  toast(title, body);
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body: body, icon: "icon-192.png", tag: "gf-saved-" + Date.now() }); } catch (e) {}
  }
}
function renderNotify() {
  var b = $("syncNotify"); if (!b) return;
  b.hidden = !("Notification" in window) || Notification.permission !== "default";
}
if ($("syncNotify")) {
  $("syncNotify").addEventListener("click", function () {
    Notification.requestPermission().then(function (p) {
      renderNotify();
      if (p === "granted") toast("Pop-ups are on", "You'll see one each time auto-save puts a file in Gower Files.");
    });
  });
  renderNotify();
}
