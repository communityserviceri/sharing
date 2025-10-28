// === Atlantis NAS — app.rtdb.js (RTDB Edition) ===
// Replace your existing app.js with this file (or adapt).
// Uses: Firebase Auth (for login), Firebase Realtime Database (folders/files metadata),
// and Firebase Storage (actual file blobs).
//
// Notes:
// - parentId uses "root" string for root-level folders (to avoid null issues in RTDB queries).
// - All users see the same folders/files (global shared NAS).
// - Recycle uses `deleted: true` on files under /files/{id}.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  getDatabase,
  ref as rdbRef,
  push,
  set,
  onValue,
  update,
  remove,
  query as rdbQuery,
  orderByChild,
  equalTo,
  runTransaction,
  get as rdbGet,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// --- Firebase config (ganti sesuai projectmu) ---
const firebaseConfig = {
  apiKey: "AIzaSyBdKELW2FNsL7H1zB8R765czcDPaSYybdg",
  authDomain: "atlantis-store.firebaseapp.com",
  databaseURL: "https://atlantis-store-default-rtdb.firebaseio.com",
  projectId: "atlantis-store",
  storageBucket: "atlantis-store.appspot.com",
  messagingSenderId: "566295949160",
  appId: "1:566295949160:web:2edd2bd1c4b74277a5f0dd",
  measurementId: "G-ERXQQKY7HM",
};

// --- Initialize ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const rdb = getDatabase(app);
const storage = getStorage(app);

// --- App state ---
let currentUser = null;
let currentFolder = "root"; // use "root" string for top-level
let breadcrumbs = [{ id: "root", name: "Root" }];
let foldersSnapshot = {}; // local cache of folders (key -> data)
let filesSnapshot = {}; // local cache of files (key -> data)
let bulkControls = null;

// --- DOM refs ---
const loginSection = document.getElementById("login-section");
const appSection = document.getElementById("app-section");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passInput = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const folderForm = document.getElementById("folder-form");
const folderInput = document.getElementById("folder-name");
const folderList = document.getElementById("folder-list");
const fileList = document.getElementById("file-list");
const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const dropArea = document.getElementById("drop-area");
const toast = document.getElementById("toast");
const folderTitle = document.getElementById("folder-title");
const globalSearch = document.getElementById("global-search");
const tabFiles = document.getElementById("tab-files");
const tabRecycle = document.getElementById("tab-recycle");
const tabSettings = document.getElementById("tab-settings");
const settingsPanel = document.getElementById("settings-panel");
const settingsTheme = document.getElementById("settings-theme");
const settingsEmail = document.getElementById("settings-email");

// --- Utilities ---
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.style.opacity = "0";
  toast.style.display = "block";
  requestAnimationFrame(() => (toast.style.opacity = "1"));
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => (toast.style.display = "none"), 250);
  }, 2000);
}
function el(tag, cls = "", attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}
function safeLog(...a) { try { console.log(...a); } catch (e) {} }

// --- AUTH ---
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = emailInput.value.trim();
  const password = passInput.value.trim();
  if (!email.endsWith("@atlantis.com")) {
    loginError.textContent = "Harap gunakan email @atlantis.com";
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "Login gagal: " + (err.message || err.code);
  }
});
logoutBtn.addEventListener("click", () => {
  signOut(auth).catch((e) => console.warn("Signout failed:", e));
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("user-info").textContent = user.email || "-";
    settingsEmail.value = user.email || "";
    loginSection.style.display = "none";
    appSection.removeAttribute("aria-hidden");
    // reset to root
    breadcrumbs = [{ id: "root", name: "Root" }];
    currentFolder = "root";
    renderBreadcrumbs();
    startRealtimeListeners();
  } else {
    currentUser = null;
    // stop listeners by detaching onValue callbacks is handled by references (onValue returns unsubscribe)
    // For simplicity we will reload page or let onValue continue but UI hidden.
    appSection.setAttribute("aria-hidden", "true");
    loginSection.style.display = "flex";
  }
});

// --- Realtime listeners (RTDB) ---
// We'll listen to /folders and /files and keep local caches foldersSnapshot/filesSnapshot.
// Rendering filters by currentFolder, deleted flag, etc.
let foldersUnsub = null;
let filesUnsub = null;

function startRealtimeListeners() {
  // folders
  const fRef = rdbRef(rdb, "folders");
  // attach listener
  foldersUnsub = onValue(fRef, (snap) => {
    const val = snap.val() || {};
    foldersSnapshot = val;
    renderFolders();
  }, (err) => {
    console.warn("folders onValue error:", err);
    showToast("Gagal listening folders (RTDB).");
  });

  // files
  const filesRef = rdbRef(rdb, "files");
  filesUnsub = onValue(filesRef, (snap) => {
    const val = snap.val() || {};
    filesSnapshot = val;
    renderFiles();
  }, (err) => {
    console.warn("files onValue error:", err);
    showToast("Gagal listening files (RTDB).");
  });
}

// --- Breadcrumbs rendering ---
function renderBreadcrumbs() {
  let bc = document.getElementById("breadcrumb");
  if (!bc) {
    bc = el("div", "breadcrumbs");
    bc.id = "breadcrumb";
    const filesHeader = document.querySelector(".files-header");
    if (filesHeader && filesHeader.parentNode) {
      filesHeader.parentNode.insertBefore(bc, filesHeader);
    } else {
      const right = document.querySelector(".right-col");
      if (right) right.prepend(bc);
    }
  }
  bc.innerHTML = "";
  breadcrumbs.forEach((b, idx) => {
    const crumb = el("button", "btn crumb");
    crumb.textContent = idx === 0 ? b.name : " / " + b.name;
    crumb.onclick = () => {
      breadcrumbs = breadcrumbs.slice(0, idx + 1);
      const target = b.id || "root";
      openFolder(target, b.name);
    };
    bc.appendChild(crumb);
  });
}

// --- Render folders (only children of currentFolder) ---
function renderFolders() {
  folderList.innerHTML = "";
  // folderSnapshot: { id: { name, parentId, fileCount, createdAt, ... } }
  const items = [];
  for (const id in foldersSnapshot) {
    const f = foldersSnapshot[id];
    const parentId = f.parentId || "root";
    if (parentId === (currentFolder || "root")) {
      items.push({ id, ...f });
    }
  }
  // sort by localCreatedAt desc if present
  items.sort((a, b) => (b.localCreatedAt || b.createdAt || 0) - (a.localCreatedAt || a.createdAt || 0));
  items.forEach((f) => {
    const div = el("div", "folder-card");
    div.dataset.id = f.id;
    div.innerHTML = `<span>📁 ${f.name}</span><small class="small-muted">${f.fileCount || 0} file</small>`;
    // open folder on click
    div.onclick = (e) => {
      e.stopPropagation();
      breadcrumbs.push({ id: f.id, name: f.name });
      renderBreadcrumbs();
      openFolder(f.id, f.name);
    };
    // drag target
    div.ondragover = (e) => { e.preventDefault(); div.classList.add("drag-over"); };
    div.ondragleave = () => div.classList.remove("drag-over");
    div.ondrop = (e) => handleMoveFiles(e, f.id);
    // context menu -> rename / delete
    div.oncontextmenu = (e) => {
      e.preventDefault();
      const choice = prompt("Rename folder (kosong = batalkan):", f.name);
      if (choice && choice.trim() !== f.name) {
        update(rdbRef(rdb, `folders/${f.id}`), { name: choice.trim() })
          .then(() => showToast("✏️ Nama folder diperbarui"))
          .catch((err) => { console.warn(err); showToast("Gagal mengganti nama folder"); });
      }
    };
    folderList.appendChild(div);
  });
}

// --- Render files for currentFolder (and not deleted) ---
function renderFiles() {
  fileList.innerHTML = "";
  ensureBulkControls();
  const items = [];
  for (const id in filesSnapshot) {
    const fi = filesSnapshot[id];
    if ((fi.folderId || "root") === (currentFolder || "root") && !fi.deleted) {
      items.push({ id, ...fi });
    }
  }
  // sort by createdAt desc
  items.sort((a, b) => (b.createdAt || b.localCreatedAt || 0) - (a.createdAt || a.localCreatedAt || 0));

  items.forEach((f) => {
    const li = el("li", "file-row");
    li.dataset.id = f.id;
    li.draggable = true;
    const created = f.createdAt ? new Date(f.createdAt).toLocaleString() : "baru";
    li.innerHTML = `
      <div class="file-info">
        <input type="checkbox" class="file-checkbox" data-id="${f.id}" />
        <div class="file-meta" style="margin-left:8px;">
          <span class="file-name">${f.name}</span>
          <span class="file-sub">${formatBytes(f.size || 0)} • ${created}</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="btn" data-preview="${f.url || ''}">👁️</button>
        <button class="btn danger" data-delete="${f.id}" data-path="${f.storagePath || ''}">🗑️</button>
      </div>
    `;
    li.ondragstart = (e) => { e.dataTransfer.setData("text/plain", f.id); };
    fileList.appendChild(li);
  });
  attachFileRowHandlers();
}

// --- Opening folder ---
function openFolder(id, name) {
  currentFolder = id || "root";
  folderTitle.textContent = "📂 " + (name || "Root");
  if (dropArea) dropArea.innerHTML = `<p>Tarik & lepas file di sini, atau klik Upload</p><small class="muted">Folder saat ini: ${name || "Root"}</small>`;
  renderBreadcrumbs();
  renderFolders();
  renderFiles();
}

// --- Create folder (RTDB push) ---
folderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = folderInput.value.trim();
  if (!name || !currentUser) return;
  try {
    const newRef = push(rdbRef(rdb, "folders"));
    const payload = {
      name,
      parentId: currentFolder || "root",
      fileCount: 0,
      createdBy: currentUser.email,
      createdAt: Date.now(),
      localCreatedAt: Date.now(),
      shared: true,
    };
    await set(newRef, payload);
    folderInput.value = "";
    showToast("📁 Folder dibuat (RTDB)");
  } catch (err) {
    console.error("Create folder RTDB failed:", err);
    showToast("Gagal membuat folder");
  }
});

// --- Upload files (to Storage) & create metadata in RTDB ---
uploadBtn.onclick = () => fileInput.click();
fileInput.onchange = (e) => handleFilesUpload(e.target.files);

dropArea.ondragover = (e) => { e.preventDefault(); dropArea.classList.add("dragover"); };
dropArea.ondragleave = () => dropArea.classList.remove("dragover");
dropArea.ondrop = (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  handleFilesUpload(e.dataTransfer.files);
};

let globalProgressEl = null;
function ensureGlobalProgress() {
  if (globalProgressEl) return;
  globalProgressEl = el("div", "global-progress");
  globalProgressEl.style.position = "fixed";
  globalProgressEl.style.left = "20px";
  globalProgressEl.style.bottom = "140px";
  globalProgressEl.style.background = "rgba(0,0,0,0.6)";
  globalProgressEl.style.color = "#fff";
  globalProgressEl.style.padding = "8px 12px";
  globalProgressEl.style.borderRadius = "10px";
  globalProgressEl.style.display = "none";
  document.body.appendChild(globalProgressEl);
}
function showGlobalProgress(msg) {
  ensureGlobalProgress();
  globalProgressEl.textContent = msg;
  globalProgressEl.style.display = "block";
}
function hideGlobalProgress() {
  if (!globalProgressEl) return;
  globalProgressEl.style.display = "none";
}

function handleFilesUpload(files) {
  if (!currentUser) return showToast("Harap login dulu");
  const arr = [...files];
  if (arr.length === 0) return;
  showGlobalProgress(`Uploading ${arr.length} file(s)...`);
  let completed = 0;
  arr.forEach((file) => {
    const path = `${currentUser.uid}/${currentFolder || "root"}/${Date.now()}_${file.name}`;
    const sRef = storageRef(storage, path);
    const task = uploadBytesResumable(sRef, file);
    task.on("state_changed",
      (snap) => {
        const percent = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        showGlobalProgress(`⬆️ ${file.name} — ${percent}%`);
      },
      (err) => {
        console.error("Upload failed:", err);
        showToast("Upload gagal: " + (err.message || err.code));
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          // push metadata to RTDB
          const newFileRef = push(rdbRef(rdb, "files"));
          const payload = {
            name: file.name,
            size: file.size,
            folderId: currentFolder || "root",
            owner: currentUser.email,
            storagePath: path,
            url,
            createdAt: Date.now(),
            localCreatedAt: Date.now(),
            deleted: false,
          };
          await set(newFileRef, payload);
          // increment folder fileCount transactionally
          if ((currentFolder || "root") !== "root") {
            const countRef = rdbRef(rdb, `folders/${currentFolder}/fileCount`);
            try {
              await runTransaction(countRef, (cur) => (cur || 0) + 1);
            } catch (e) {
              console.warn("increment folder count failed:", e);
            }
          }
          completed++;
          if (completed === arr.length) {
            showToast("✅ Semua upload selesai");
            hideGlobalProgress();
          }
        } catch (err) {
          console.error("Finalize upload failed:", err);
          showToast("Gagal menyelesaikan upload");
          hideGlobalProgress();
        }
      }
    );
  });
}

// --- Attach file row handlers (preview, delete, checkboxes) ---
function attachFileRowHandlers() {
  // preview buttons
  fileList.querySelectorAll("button[data-preview]").forEach((btn) => {
    btn.onclick = (e) => {
      const url = btn.getAttribute("data-preview");
      if (url) previewFile(url);
    };
  });
  // delete -> soft delete to recycle
  fileList.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = btn.getAttribute("data-delete");
      if (!id) return;
      if (!confirm("Hapus file ini? File akan dipindahkan ke Recycle Bin.")) return;
      try {
        // mark deleted
        await update(rdbRef(rdb, `files/${id}`), { deleted: true, deletedAt: Date.now() });
        // decrement folder count if needed
        const fileMeta = filesSnapshot[id] || null;
        if (fileMeta && fileMeta.folderId && fileMeta.folderId !== "root") {
          const cntRef = rdbRef(rdb, `folders/${fileMeta.folderId}/fileCount`);
          try {
            await runTransaction(cntRef, (cur) => Math.max(0, (cur || 0) - 1));
          } catch (e) { console.warn("decrement folder count failed:", e); }
        }
        showToast("🗑️ File dipindahkan ke Recycle Bin");
      } catch (err) {
        console.error("Soft-delete failed:", err);
        showToast("Gagal memindahkan file ke Recycle Bin");
      }
    };
  });
  // checkboxes
  fileList.querySelectorAll(".file-checkbox").forEach((cb) => { cb.onchange = updateBulkSelectionUI; });
}

// --- Bulk controls ---
function ensureBulkControls() {
  if (bulkControls) return;
  bulkControls = el("div", "bulk-controls");
  bulkControls.id = "bulk-controls";
  bulkControls.innerHTML = `
    <button id="bulk-download" class="btn">⬇️ Download selected</button>
    <button id="bulk-delete" class="btn danger">🗑️ Delete selected</button>
    <button id="clear-selection" class="btn">✖ Clear</button>
  `;
  document.body.appendChild(bulkControls);
  bulkControls.querySelector("#clear-selection").onclick = () => {
    fileList.querySelectorAll(".file-checkbox").forEach((cb) => (cb.checked = false));
    updateBulkSelectionUI();
  };
  bulkControls.querySelector("#bulk-delete").onclick = bulkDeleteSelected;
  bulkControls.querySelector("#bulk-download").onclick = bulkDownloadSelected;
  updateBulkSelectionUI();
}
function updateBulkSelectionUI() {
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked"));
  if (!bulkControls) return;
  bulkControls.style.display = selected.length > 0 ? "block" : "none";
  bulkControls.querySelector("#bulk-download").textContent = `⬇️ Download (${selected.length})`;
  bulkControls.querySelector("#bulk-delete").textContent = `🗑️ Delete (${selected.length})`;
}
async function bulkDeleteSelected() {
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked")).map((c) => c.dataset.id);
  if (selected.length === 0) return showToast("Pilih file dulu");
  if (!confirm(`Hapus ${selected.length} file? File akan dipindahkan ke Recycle Bin.`)) return;
  for (const id of selected) {
    try {
      await update(rdbRef(rdb, `files/${id}`), { deleted: true, deletedAt: Date.now() });
      // update folder count if needed
      const fileMeta = filesSnapshot[id] || null;
      if (fileMeta && fileMeta.folderId && fileMeta.folderId !== "root") {
        const cntRef = rdbRef(rdb, `folders/${fileMeta.folderId}/fileCount`);
        try { await runTransaction(cntRef, (cur) => Math.max(0, (cur || 0) - 1)); } catch (e) {}
      }
    } catch (e) { console.warn("bulk soft-delete failed", e); }
  }
  showToast("🗑️ Bulk moved to Recycle");
}
async function bulkDownloadSelected() {
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked")).map((c) => c.dataset.id);
  if (selected.length === 0) return showToast("Pilih file dulu");
  showToast("Membuka file di tab baru untuk download...");
  for (const id of selected) {
    try {
      const meta = filesSnapshot[id];
      if (meta && meta.url) window.open(meta.url, "_blank");
    } catch (err) { console.warn("open file failed", err); }
  }
}

// --- Move file by drag/drop into folder ---
async function handleMoveFiles(e, targetFolderId) {
  e.preventDefault();
  const fileId = e.dataTransfer.getData("text/plain");
  if (!fileId) return;
  try {
    const fmeta = filesSnapshot[fileId];
    if (!fmeta) return;
    const srcFolder = fmeta.folderId || "root";
    if (srcFolder === targetFolderId) return showToast("File sudah di folder tersebut");
    // update file's folderId
    await update(rdbRef(rdb, `files/${fileId}`), { folderId: targetFolderId });
    // adjust counts
    if (srcFolder && srcFolder !== "root") {
      await runTransaction(rdbRef(rdb, `folders/${srcFolder}/fileCount`), (cur) => Math.max(0, (cur || 0) - 1));
    }
    if (targetFolderId && targetFolderId !== "root") {
      await runTransaction(rdbRef(rdb, `folders/${targetFolderId}/fileCount`), (cur) => (cur || 0) + 1);
    }
    showToast("📦 File dipindahkan");
  } catch (err) {
    console.error("move failed:", err);
    showToast("Gagal memindahkan file");
  }
}

// --- Preview modal ---
window.previewFile = (url) => {
  const modal = document.getElementById("preview-modal");
  const body = document.getElementById("preview-body");
  const download = document.getElementById("preview-download");
  body.innerHTML = `<iframe src="${url}" width="100%" height="600" style="border:0;border-radius:8px;"></iframe>`;
  download.href = url;
  modal.setAttribute("aria-hidden", "false");
};
document.getElementById("close-preview").onclick = () =>
  document.getElementById("preview-modal").setAttribute("aria-hidden", "true");

// --- Recycle bin view (show deleted files globally) ---
function loadRecycleView() {
  // Render filesSnapshot where deleted === true
  fileList.innerHTML = "";
  const items = [];
  for (const id in filesSnapshot) {
    const f = filesSnapshot[id];
    if (f.deleted) items.push({ id, ...f });
  }
  items.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  items.forEach((f) => {
    const li = el("li", "file-row");
    li.innerHTML = `
      <div class="file-info">
        🗑️ <span class="file-name">${f.name}</span>
        <div class="file-sub">${formatBytes(f.size || 0)} • ${f.deletedAt ? new Date(f.deletedAt).toLocaleString() : "baru"}</div>
      </div>
      <div class="file-actions">
        <button class="btn" data-restore="${f.id}">♻️ Restore</button>
        <button class="btn danger" data-permadelete="${f.id}" data-path="${f.storagePath || ''}">❌ Hapus Permanen</button>
      </div>
    `;
    fileList.appendChild(li);
  });
  // attach handlers
  fileList.querySelectorAll("button[data-restore]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-restore");
      if (!id) return;
      try {
        // restore
        await update(rdbRef(rdb, `files/${id}`), { deleted: false, deletedAt: null });
        // increment folder count if folder exists
        const meta = filesSnapshot[id];
        if (meta && meta.folderId && meta.folderId !== "root") {
          try { await runTransaction(rdbRef(rdb, `folders/${meta.folderId}/fileCount`), (cur) => (cur || 0) + 1); } catch (e) {}
        }
        showToast("♻️ Dipulihkan");
      } catch (err) { console.error("restore failed", err); showToast("Gagal memulihkan"); }
    };
  });
  fileList.querySelectorAll("button[data-permadelete]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-permadelete");
      const path = btn.getAttribute("data-path");
      if (!id) return;
      if (!confirm("Hapus permanen file ini? Tindakan ini tidak bisa dibatalkan.")) return;
      try {
        await remove(rdbRef(rdb, `files/${id}`));
        if (path) await deleteObject(storageRef(storage, path)).catch((e) => console.warn("storage delete fail", e));
        showToast("❌ File dihapus permanen");
      } catch (err) { console.error("permadelete failed", err); showToast("Gagal hapus permanen"); }
    };
  });
}

// --- Tabs handling ---
let activeTab = "files";
tabFiles.onclick = () => { activeTab = "files"; setActiveTabUI(); };
tabRecycle.onclick = () => { activeTab = "recycle"; setActiveTabUI(); };
tabSettings.onclick = () => { activeTab = "settings"; setActiveTabUI(); };

function setActiveTabUI() {
  tabFiles.classList.toggle("active", activeTab === "files");
  tabRecycle.classList.toggle("active", activeTab === "recycle");
  tabSettings.classList.toggle("active", activeTab === "settings");
  const content = document.querySelector(".content");
  if (content) content.style.display = activeTab === "files" ? "flex" : "none";
  settingsPanel.setAttribute("aria-hidden", activeTab === "settings" ? "false" : "true");
  if (activeTab === "files") {
    renderFolders();
    renderFiles();
  } else if (activeTab === "recycle") {
    loadRecycleView();
  }
}

// --- Search debounce (client side) ---
let searchTimer = null;
globalSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const term = globalSearch.value.trim().toLowerCase();
    if (!term) {
      Array.from(fileList.children).forEach((li) => (li.style.display = ""));
      return;
    }
    Array.from(fileList.children).forEach((li) => {
      const name = (li.querySelector(".file-name")?.textContent || "").toLowerCase();
      li.style.display = name.includes(term) ? "" : "none";
    });
  }, 200);
});

// --- Theme handling (simple) ---
const themeBtn = document.getElementById("toggle-theme");
themeBtn.onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  if (settingsTheme) settingsTheme.value = next;
};
document.documentElement.dataset.theme =
  localStorage.getItem("theme") ||
  (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
if (settingsTheme) settingsTheme.value = document.documentElement.dataset.theme;
settingsTheme?.addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "auto") {
    const auto = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = auto;
    localStorage.setItem("theme", auto);
  } else {
    document.documentElement.dataset.theme = v;
    localStorage.setItem("theme", v);
  }
});

// --- Helpers: start listeners and render initial UI ---
function start() {
  breadcrumbs = [{ id: "root", name: "Root" }];
  renderBreadcrumbs();
  if (dropArea) dropArea.innerHTML = `<p>Tarik & lepas file di sini, atau klik Upload</p><small class="muted">Folder saat ini: Root</small>`;
  showToast("Atlantis NAS RTDB siap");
  setActiveTabUI();
}
start();

// --- Clean public API exposure for preview (ke index.html) ---
safeLog("Atlantis NAS RTDB edition loaded");

function safeLog(...a) { try { console.log(...a); } catch (e) {} }
