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
var PREVIEW = { pdf: "pdf", png: "img", jpg: "img", jpeg: "img", gif: "img", webp: "img", txt: "text", md: "text", csv: "text" };

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
    var p = new URLSearchParams(location.search), fo = p.get("folder"), q = p.get("q");
    if (fo) { var m = folders.filter(function (f) { return String(f.name).toLowerCase() === fo.toLowerCase(); })[0]; if (m) cur = m.id; }
    if (q) $("q").value = q;
    if (fo || q) history.replaceState(null, "", location.pathname);
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
  if (!hit) return null;
  var f = folders.filter(function (x) { return String(x.name).toLowerCase() === hit[2].toLowerCase(); })[0];
  return f ? { id: f.id, name: f.name } : null;
}
var autoFile = true;
try { autoFile = localStorage.getItem("gf-autofile") !== "off"; } catch (e) {}
function render() {
  pending = false;
  applyUrl();
  var live = files.filter(function (f) { return !f.deletedAt; }), binned = files.filter(function (f) { return f.deletedAt; });
  var now = Date.now(), recent = live.filter(function (f) { return now - changedAt(f) < RECENT_DAYS * DAY; });
  var today = londonParts().date, todays = live.filter(function (f) { return f.today === today; });
  var counts = { all: live.length, today: todays.length, recent: Math.min(recent.length, 20), bin: binned.length };
  live.forEach(function (f) { var k = realFolder(f.folder); counts[k] = (counts[k] || 0) + 1; });
  var tabs = [["all", "All"], ["today", "For today"], ["recent", "Recent"], ["inbox", "Inbox"]].concat(folders.map(function (f) { return [f.id, f.name]; }), [["bin", "Bin"]]);
  if (!tabs.some(function (t) { return t[0] === cur; })) cur = "all";
  var inBin = cur === "bin";
  $("chips").innerHTML = tabs.map(function (t) { return '<button type="button" data-act="cur" data-id="' + esc(t[0]) + '" aria-pressed="' + (t[0] === cur) + '">' + esc(t[1]) + " (" + (counts[t[0]] || 0) + ")</button>"; }).join("");
  var ln = (cur === "all" || cur === "recent" || cur === "today") ? lectureNow() : null;
  $("target").textContent = "Uploads go to: " + (realTarget() === "inbox" ? "Inbox" : folderName(realTarget())) + (ln ? " (you're in that lecture now)" : "") + ". A whole folder keeps its own subfolders as folders here.";

  var tf = $("tagF").value;
  $("tagF").innerHTML = '<option value="">Any tag</option>' + TAGS.map(function (t) { return '<option' + (t === tf ? " selected" : "") + ">" + t + "</option>"; }).join("");

  var q = $("q").value.trim().toLowerCase(), sort = $("sort").value, list;
  if (inBin) list = binned.slice();
  else if (cur === "today") list = todays.slice();
  else if (cur === "recent") list = recent.slice().sort(function (a, b) { return changedAt(b) - changedAt(a); }).slice(0, 20);
  else list = live.filter(function (f) { return cur === "all" || realFolder(f.folder) === cur; });
  list = list.filter(function (f) {
    if (tf && (f.tags || []).indexOf(tf) < 0) return false;
    if (!q) return true;
    return (f.name + " " + (f.note || "") + " " + (f.tags || []).join(" ") + " " + (f.rel || "")).toLowerCase().indexOf(q) >= 0;
  });
  if (cur !== "recent") list.sort(function (a, b) {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "size") return (b.size || 0) - (a.size || 0);
    if (sort === "old") return changedAt(a) - changedAt(b);
    return changedAt(b) - changedAt(a);
  });
  $("count").textContent = list.length + (list.length === 1 ? " file" : " files") + (inBin ? " in the bin · removed for good after " + BIN_DAYS + " days" : cur === "recent" ? " changed in the last " + RECENT_DAYS + " days" : cur === "today" ? " set aside for today (clears tomorrow)" : "");
  $("zipBtn").hidden = inBin || !list.length;
  $("emptyBin").hidden = !inBin || !list.length;
  $("emptyBin").textContent = sure === "empty" ? "Tap again to empty the bin" : "Empty bin";
  $("emptyBin").classList.toggle("sure", sure === "empty");

  $("files").innerHTML = list.length ? list.map(function (f) { return inBin ? binRow(f) : fileRow(f); }).join("")
    : '<div class="none">' + (inBin ? "The bin is empty." : cur === "today" ? "Nothing set aside for today. Tap \u201cFor today\u201d under a file." : live.length ? "No files match." : "No files yet. Drop some above.") + "</div>";

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
  var total = 0; files.forEach(function (f) { total += f.size || 0; (f.versions || []).forEach(function (v) { total += v.size || 0; }); });
  var pc = Math.min(100, total / FREE_BYTES * 100);
  $("usage").innerHTML = '<div class="meter"><span style="width:' + pc.toFixed(1) + '%"' + (pc > 80 ? ' class="hi"' : "") + '></span></div>' + esc(live.length + " files · " + fmtSize(total) + " of the 5 GB free allowance used (" + (pc < 1 && total ? "under 1" : Math.round(pc)) + "%), including older versions and the bin");
  $("autoFile").checked = autoFile;
  if (editing) { var i = $("renameIn"); if (i) { i.focus(); i.select(); } }
}

function fileRow(f) {
  var isEd = editing === f.id, rmOn = sure === "rm:" + f.id, ext = extOf(f.name), vs = f.versions || [], tags = f.tags || [];
  var meta = "<span>" + fmtSize(f.size || 0) + "</span><span>" + (f.updatedAt ? "Updated " : "") + fmtDate(changedAt(f)) + "</span><span>" + esc(folderName(f.folder)) + "</span>" +
    (vs.length ? "<span>" + (vs.length + 1) + " versions</span>" : "") + tags.map(function (t) { return '<span class="tag ' + t + '">' + t + "</span>"; }).join("");
  var more = "";
  if (open[f.id]) {
    more = '<div class="more"><div class="chips">' + TAGS.map(function (t) { return '<button type="button" data-act="tag" data-id="' + esc(f.id) + '" data-tag="' + t + '" aria-pressed="' + (tags.indexOf(t) >= 0) + '">' + t + "</button>"; }).join("") + "</div>" +
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
function maybeTidy() { if (foldersLoaded && filesLoaded && !tidied) { tidied = true; removeUnitFolders().then(sortByLevel); } }
/* One-off: put files into Level 2 and Level 3. A file that came from a folder named "Level 2" or "Level 3" goes there;
   otherwise older files (last changed before 1 Sept 2026, when Level 3 started) go to Level 2 and newer ones to Level 3. Uses the file's own date from your computer, not the upload date.
   Folders left empty afterwards are removed, except Home. Files in Home and in the bin are left alone. */
var LEVEL_CUTOFF = Date.UTC(2026, 8, 1);
function sortByLevel() {
  var flag = doc(db, "users", uid, "meta", "levels1");
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
    if (kind === "text") return blob.slice(0, 300000).text().then(function (t) { var pre = document.createElement("pre"); pre.textContent = t; $("mBody").innerHTML = ""; $("mBody").appendChild(pre); });
    var typed = new Blob([blob], { type: kind === "pdf" ? "application/pdf" : (blob.type || "image/" + extOf(f.name)) });
    objUrl = URL.createObjectURL(typed);
    $("mBody").innerHTML = kind === "pdf" ? '<iframe title="' + esc(f.name) + '" src="' + objUrl + '"></iframe>' : '<img alt="' + esc(f.name) + '" src="' + objUrl + '">';
  }).catch(function (e) {
    $("mBody").innerHTML = '<div class="hint" style="padding:16px">Couldn\'t load the preview (' + esc(e.code || e.message) + "). If this keeps happening, do step 8 in SETUP.md. You can still use Download.</div>";
  });
}

/* ---------- zip a list ---------- */
var jszipLoad = null;
function loadZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipLoad) jszipLoad = new Promise(function (res, rej) {
    var s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
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
    if (cur !== "all" && cur !== "recent" && cur !== "today" && realFolder(f.folder) !== cur) return false;
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
  if (cur === "all" || cur === "recent" || cur === "today" || cur === "bin") { var l = lectureNow(); return l ? l.id : "inbox"; }
  return cur;
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
function folderFor(rel) {
  var parts = rel.split("/");
  if (parts.length >= 3) return ensureFolder(parts[1]);
  if (parts.length === 2) return ensureFolder(parts[0]);
  return Promise.resolve(realTarget());
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
    it.row = row; it.target = realTarget();
    waiting.push(it);
  });
  if (skipped) note(skipped + " temporary or system file" + (skipped === 1 ? " was" : "s were") + " skipped.");
  pump();
}
function pump() {
  while (running < 3 && waiting.length) {
    running++;
    (function (it) {
      (it.rel ? folderFor(it.rel) : Promise.resolve(it.target)).then(function (folder) {
        var existing = files.filter(function (f) { return !f.deletedAt && f.name === it.file.name && realFolder(f.folder) === realFolder(folder); })[0];
        if (existing && existing.size === it.file.size && existing.srcModified === it.file.lastModified) {
          it.row.querySelector(".pc").textContent = "already up to date";
          setTimeout(function () { it.row.remove(); }, 2500);
          return;
        }
        return existing ? sendVersion(existing, it.file, it.row) : sendNew(it.file, folder, it.rel, it.row);
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
function sendNew(file, folder, rel, row) {
  var id = newId(), path = "users/" + uid + "/files/" + id + "/" + safeName(file.name);
  return put(path, file, file.name, row).then(function () {
    return setDoc(doc(filecol(), id), { name: file.name, folder: folder, size: file.size, type: file.type || "", path: path, createdAt: Date.now(), srcModified: file.lastModified || 0, rel: rel || "", tags: [], note: "" });
  }).then(function () { if (row) row.remove(); });
}
function sendVersion(f, file, row) {
  if (!row) {
    row = document.createElement("div"); row.className = "up";
    row.innerHTML = "<span>New version of " + esc(f.name) + ' <span class="pc">0%</span></span><div class="bar"><span></span></div>';
    $("ups").appendChild(row);
  } else row.querySelector("span").firstChild.textContent = "New version of " + f.name + " ";
  var path = "users/" + uid + "/files/" + f.id + "/v" + Date.now().toString(36) + "/" + safeName(f.name);
  return put(path, file, f.name, row).then(function () {
    var vs = (f.versions || []).concat([{ path: f.path, size: f.size || 0, at: changedAt(f) }]), drop = [];
    while (vs.length > MAX_VERSIONS) drop.push(vs.shift().path);
    return updateDoc(doc(filecol(), f.id), { path: path, size: file.size, updatedAt: Date.now(), srcModified: file.lastModified || 0, versions: vs }).then(function () { return deletePaths(drop); });
  }).then(function () { row.remove(); }, function (er) { row.classList.add("err"); row.textContent = f.name + ": upload failed (" + (er.code || er.message) + ")"; });
}
