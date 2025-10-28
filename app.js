// === Atlantis NAS — app.js (updated) ===
// Features:
// - Tabs (Files, Recycle Bin, Settings)
// - Recycle bin (soft delete / restore / permanent delete)
// - Nested folders (parentId), breadcrumbs, folder-in-folder explorer UI
// - Real-time listeners via onSnapshot wrapped with safeOnSnapshot
// - localCreatedAt to reduce duplicate/flash when using serverTimestamp
// - Upload, move, bulk actions, preview, theme settings, offline persistence

// --- Firebase imports (modular) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  enableIndexedDbPersistence,
  getDoc,
  getDocs,
  limit,
  increment,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// --- Firebase config (ganti kalau perlu) ---
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

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Enable offline persistence (best-effort)
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("Firestore persistence not enabled:", err && err.code ? err.code : err);
});

// --- App state ---
let currentUser = null;
let currentFolder = null; // folder id (null => root)
let folderUnsub = null;
let fileUnsub = null;
let breadcrumbs = []; // [{id, name}]
let bulkControls = null;
let activeTab = "files"; // "files" | "recycle" | "settings"

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
  }, 2200);
}
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}
function el(tag, cls = "", attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}
function safeLog(...a) {
  try {
    console.log(...a);
  } catch (e) {}
}

// Wrapper for onSnapshot with friendly messaging
function safeOnSnapshot(q, onData, label = "listener") {
  try {
    return onSnapshot(
      q,
      (snap) => onData(snap),
      (err) => {
        console.warn(`Firestore ${label} error:`, err);
        if (err && err.code === "failed-precondition") {
          showToast("⚠️ Firestore: index composite diperlukan. Cek console.");
        } else if (err && err.code === "permission-denied") {
          showToast("🚫 Akses ke Firestore ditolak. Periksa rules.");
        } else {
          showToast("❌ Koneksi realtime Firestore terganggu.");
        }
      }
    );
  } catch (e) {
    console.error("safeOnSnapshot setup failed:", e);
  }
}

// --- AUTH FLOW ---
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
    document.getElementById("user-info").textContent = user.email;
    settingsEmail.value = user.email || "";
    loginSection.style.display = "none";
    appSection.removeAttribute("aria-hidden");
    // reset to root view
    breadcrumbs = [{ id: null, name: "Root" }];
    currentFolder = null;
    activeTab = "files";
    renderBreadcrumbs();
    setActiveTabUI();
    // start listeners
    loadFoldersRealtime();
    loadFilesRealtime();
  } else {
    currentUser = null;
    // clean up listeners
    if (folderUnsub) folderUnsub();
    if (fileUnsub) fileUnsub();
    appSection.setAttribute("aria-hidden", "true");
    loginSection.style.display = "flex";
  }
});

// --- Breadcrumbs (render + navigation) ---
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
      const target = b.id || null;
      openFolder(target, b.name);
    };
    bc.appendChild(crumb);
  });
}

// --- Folder realtime (children of currentFolder) ---
// Use localCreatedAt to minimize flash of duplicates
function loadFoldersRealtime() {
  if (!currentUser) return;
  // Query children where createdBy == currentUser.email && parentId == currentFolder
  const q = query(
    collection(db, "folders"),
    where("createdBy", "==", currentUser.email),
    where("parentId", "==", currentFolder || null),
    orderBy("localCreatedAt", "desc")
  );
  if (folderUnsub) folderUnsub();
  folderUnsub = safeOnSnapshot(
    q,
    (snap) => {
      folderList.innerHTML = "";
      snap.forEach((docu) => {
        const f = docu.data();
        const div = el("div", "folder-card");
        div.dataset.id = docu.id;
        div.innerHTML = `
          <span>📁 ${f.name}</span>
          <small class="small-muted">${f.fileCount || 0} file</small>
        `;
        div.onclick = (e) => {
          e.stopPropagation();
          breadcrumbs.push({ id: docu.id, name: f.name });
          renderBreadcrumbs();
          openFolder(docu.id, f.name);
        };
        // drag target for files
        div.ondragover = (e) => {
          e.preventDefault();
          div.classList.add("drag-over");
        };
        div.ondragleave = () => div.classList.remove("drag-over");
        div.ondrop = (e) => handleMoveFiles(e, docu.id);
        // right-click: rename or delete folder
        div.oncontextmenu = async (e) => {
          e.preventDefault();
          const choice = prompt("Rename folder (kosong = batalkan):", f.name);
          if (choice && choice.trim() !== f.name) {
            try {
              await updateDoc(doc(db, "folders", docu.id), { name: choice.trim() });
              showToast("✏️ Nama folder diperbarui");
            } catch (err) {
              console.error("Rename folder failed:", err);
              showToast("Gagal mengganti nama folder");
            }
          }
        };
        folderList.appendChild(div);
      });
    },
    "folders"
  );
}

// --- Create folder (supports parentId) ---
folderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = folderInput.value.trim();
  if (!name || !currentUser) return;
  try {
    // add localCreatedAt to reduce flicker / duplication from serverTimestamp delay
    await addDoc(collection(db, "folders"), {
      name,
      createdBy: currentUser.email,
      parentId: currentFolder || null,
      createdAt: serverTimestamp(),
      localCreatedAt: Date.now(),
      fileCount: 0,
    });
    folderInput.value = "";
    showToast("📁 Folder dibuat");
  } catch (err) {
    console.error("Create folder failed:", err);
    showToast("Gagal membuat folder");
  }
});

// --- Open folder: update state + reload children/files ---
async function openFolder(id, name) {
  currentFolder = id || null;
  folderTitle.textContent = "📂 " + (name || "Root");
  // update dropArea hint
  if (dropArea) {
    dropArea.innerHTML = `<p>Tarik & lepas file di sini, atau klik Upload</p><small class="muted">Folder saat ini: ${name || "Root"}</small>`;
  }
  renderBreadcrumbs();
  // refresh listeners
  loadFoldersRealtime();
  loadFilesRealtime();
}

// --- Files realtime (per currentFolder) ---
function loadFilesRealtime() {
  if (!currentUser) return;
  const q = query(
    collection(db, "files"),
    where("folderId", "==", currentFolder || null),
    where("owner", "==", currentUser.email),
    where("deleted", "==", false),
    orderBy("createdAt", "desc")
  );
  if (fileUnsub) fileUnsub();
  fileUnsub = safeOnSnapshot(
    q,
    (snap) => {
      fileList.innerHTML = "";
      ensureBulkControls();
      snap.forEach((docu) => {
        const f = docu.data();
        const li = el("li", "file-row");
        li.dataset.id = docu.id;
        li.draggable = true;
        const created = f.createdAt?.seconds
          ? new Date(f.createdAt.seconds * 1000).toLocaleString()
          : "baru";
        li.innerHTML = `
          <div class="file-info">
            <input type="checkbox" class="file-checkbox" data-id="${docu.id}" />
            <div class="file-meta" style="margin-left:8px;">
              <span class="file-name">${f.name}</span>
              <span class="file-sub">${formatBytes(f.size)} • ${created}</span>
            </div>
          </div>
          <div class="file-actions">
            <button class="btn" data-preview="${f.url}">👁️</button>
            <button class="btn danger" data-delete="${docu.id}" data-path="${f.storagePath}">🗑️</button>
          </div>
        `;
        li.ondragstart = (e) => {
          e.dataTransfer.setData("text/plain", docu.id);
        };
        fileList.appendChild(li);
      });
      attachFileRowHandlers();
    },
    "files"
  );
}

// --- File row handlers (preview, delete, checkboxes) ---
function attachFileRowHandlers() {
  // preview
  fileList.querySelectorAll("button[data-preview]").forEach((btn) => {
    btn.onclick = (e) => {
      const url = btn.getAttribute("data-preview");
      if (url) previewFile(url);
    };
  });
  // delete (soft-delete -> move to recycle)
  fileList.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = btn.getAttribute("data-delete");
      if (!id) return;
      if (!confirm("Hapus file ini? File akan dipindahkan ke Recycle Bin.")) return;
      try {
        await updateDoc(doc(db, "files", id), {
          deleted: true,
          deletedAt: serverTimestamp(),
        });
        // decrement folder fileCount safely using transaction if folder exists
        try {
          const fd = await getDoc(doc(db, "files", id));
          const fdata = fd.exists() ? fd.data() : null;
          if (fdata?.folderId) {
            const folderRef = doc(db, "folders", fdata.folderId);
            await runTransaction(db, async (t) => {
              const snap = await t.get(folderRef);
              if (!snap.exists()) return;
              const prev = snap.data().fileCount || 0;
              t.update(folderRef, { fileCount: Math.max(0, prev - 1) });
            });
          }
        } catch (txErr) {
          console.warn("Adjust folder fileCount failed:", txErr);
        }
        showToast("🗑️ File dipindahkan ke Recycle Bin");
      } catch (err) {
        console.error("Soft-delete failed:", err);
        showToast("Gagal memindahkan file ke Recycle Bin");
      }
    };
  });
  // checkboxes
  fileList.querySelectorAll(".file-checkbox").forEach((cb) => {
    cb.onchange = updateBulkSelectionUI;
  });
}

// --- BULK UI & actions ---
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
      await updateDoc(doc(db, "files", id), { deleted: true, deletedAt: serverTimestamp() });
    } catch (err) {
      console.error("Bulk soft-delete error:", err);
    }
  }
  showToast("🗑️ Beberapa file dipindahkan ke Recycle Bin");
}

async function bulkDownloadSelected() {
  const selected = Array.from(fileList.querySelectorAll(".file-checkbox:checked")).map((c) => c.dataset.id);
  if (selected.length === 0) return showToast("Pilih file dulu");
  showToast("Membuka file di tab baru untuk download...");
  for (const id of selected) {
    try {
      const fd = await getDoc(doc(db, "files", id));
      const data = fd.exists() ? fd.data() : null;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err) {
      console.warn("Open file failed:", err);
    }
  }
}

// --- Upload handling ---
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

uploadBtn.onclick = () => fileInput.click();
fileInput.onchange = (e) => handleFilesUpload(e.target.files);

dropArea.ondragover = (e) => {
  e.preventDefault();
  dropArea.classList.add("dragover");
};
dropArea.ondragleave = () => dropArea.classList.remove("dragover");
dropArea.ondrop = (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  handleFilesUpload(e.dataTransfer.files);
};

function handleFilesUpload(files) {
  if (!currentUser) return showToast("Harap login dulu");
  const arr = [...files];
  if (arr.length === 0) return;
  showGlobalProgress(`Uploading ${arr.length} file(s)...`);
  let completed = 0;
  arr.forEach((file) => {
    const path = `${currentUser.uid}/${currentFolder || "root"}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
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
          const docRef = await addDoc(collection(db, "files"), {
            name: file.name,
            size: file.size,
            folderId: currentFolder || null,
            owner: currentUser.email,
            storagePath: path,
            url,
            createdAt: serverTimestamp(),
            localCreatedAt: Date.now(),
            deleted: false,
          });
          // increment folder fileCount safely
          if (currentFolder) {
            const folderRef = doc(db, "folders", currentFolder);
            try {
              await runTransaction(db, async (t) => {
                const fSnap = await t.get(folderRef);
                if (!fSnap.exists()) return;
                const prev = fSnap.data().fileCount || 0;
                t.update(folderRef, { fileCount: prev + 1 });
              });
            } catch (e) {
              console.warn("Folder fileCount increment failed:", e);
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

// --- Move file by drag/drop into folder ---
async function handleMoveFiles(e, targetFolderId) {
  e.preventDefault();
  const fileId = e.dataTransfer.getData("text/plain");
  if (!fileId) return;
  try {
    // fetch current file doc to adjust fileCount on source & target
    const fd = await getDoc(doc(db, "files", fileId));
    const fdata = fd.exists() ? fd.data() : null;
    if (!fdata) return;
    const srcFolder = fdata.folderId || null;
    if (srcFolder === targetFolderId) {
      showToast("File sudah berada di folder tersebut");
      return;
    }
    await updateDoc(doc(db, "files", fileId), { folderId: targetFolderId });
    // adjust counts (transactionally)
    try {
      if (srcFolder) {
        const srcRef = doc(db, "folders", srcFolder);
        await runTransaction(db, async (t) => {
          const sSnap = await t.get(srcRef);
          if (!sSnap.exists()) return;
          const prev = sSnap.data().fileCount || 0;
          t.update(srcRef, { fileCount: Math.max(0, prev - 1) });
        });
      }
      if (targetFolderId) {
        const tgtRef = doc(db, "folders", targetFolderId);
        await runTransaction(db, async (t) => {
          const tSnap = await t.get(tgtRef);
          if (!tSnap.exists()) return;
          const prev = tSnap.data().fileCount || 0;
          t.update(tgtRef, { fileCount: prev + 1 });
        });
      }
    } catch (e) {
      console.warn("Adjust folder counts after move failed:", e);
    }
    showToast("📦 File dipindahkan");
  } catch (err) {
    console.error("Move failed:", err);
    showToast("Gagal memindahkan file");
  }
}

// --- Preview ---
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

// --- SEARCH (debounced on client-side) ---
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
  }, 220);
});

// --- Keyboard shortcut: Ctrl/Cmd+K focus search ---
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    globalSearch.focus();
  }
});

// --- Theme handling ---
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

// --- Tabs: Files / Recycle / Settings ---
function setActiveTabUI() {
  // toggle active classes and visibility
  tabFiles.classList.toggle("active", activeTab === "files");
  tabRecycle.classList.toggle("active", activeTab === "recycle");
  tabSettings.classList.toggle("active", activeTab === "settings");

  // content area shown only for files tab
  const content = document.querySelector(".content");
  if (content) content.style.display = activeTab === "files" ? "flex" : "none";
  // settings panel toggle
  settingsPanel.setAttribute("aria-hidden", activeTab === "settings" ? "false" : "true");

  // load appropriate data/listeners
  if (activeTab === "files") {
    loadFoldersRealtime();
    loadFilesRealtime();
  } else if (activeTab === "recycle") {
    loadRecycleBin();
  } else if (activeTab === "settings") {
    // nothing special (settings panel already shows)
  }
}
tabFiles.onclick = () => { activeTab = "files"; setActiveTabUI(); };
tabRecycle.onclick = () => { activeTab = "recycle"; setActiveTabUI(); };
tabSettings.onclick = () => { activeTab = "settings"; setActiveTabUI(); };

// --- Recycle Bin: realtime view of deleted files ---
function loadRecycleBin() {
  if (!currentUser) return;
  const q = query(
    collection(db, "files"),
    where("owner", "==", currentUser.email),
    where("deleted", "==", true),
    orderBy("deletedAt", "desc")
  );
  if (fileUnsub) fileUnsub();
  fileUnsub = safeOnSnapshot(q, (snap) => {
    fileList.innerHTML = "";
    snap.forEach((docu) => {
      const f = docu.data();
      const li = el("li", "file-row");
      li.innerHTML = `
        <div class="file-info">
          🗑️ <span class="file-name">${f.name}</span>
          <div class="file-sub">${formatBytes(f.size)} • ${
        f.deletedAt?.seconds ? new Date(f.deletedAt.seconds * 1000).toLocaleString() : "baru"
      }</div>
        </div>
        <div class="file-actions">
          <button class="btn" data-restore="${docu.id}">♻️ Restore</button>
          <button class="btn danger" data-permadelete="${docu.id}" data-path="${f.storagePath}">❌ Hapus Permanen</button>
        </div>
      `;
      fileList.appendChild(li);
    });
    // attach restore / permanent delete
    fileList.querySelectorAll("button[data-restore]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-restore");
        if (!id) return;
        try {
          await updateDoc(doc(db, "files", id), { deleted: false, deletedAt: null });
          // optionally increment folder count if file had folderId
          try {
            const fd = await getDoc(doc(db, "files", id));
            const data = fd.exists() ? fd.data() : null;
            if (data?.folderId) {
              const folderRef = doc(db, "folders", data.folderId);
              await runTransaction(db, async (t) => {
                const snap = await t.get(folderRef);
                if (!snap.exists()) return;
                const prev = snap.data().fileCount || 0;
                t.update(folderRef, { fileCount: prev + 1 });
              });
            }
          } catch (e) {
            console.warn("Restore: increment folder failed", e);
          }
          showToast("♻️ Dipulihkan");
        } catch (err) {
          console.error("Restore failed:", err);
          showToast("Gagal memulihkan file");
        }
      };
    });
    fileList.querySelectorAll("button[data-permadelete]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-permadelete");
        const path = btn.getAttribute("data-path");
        if (!id) return;
        if (!confirm("Hapus permanen file ini? Tindakan ini tidak bisa dibatalkan.")) return;
        try {
          await deleteDoc(doc(db, "files", id));
          if (path) {
            await deleteObject(ref(storage, path)).catch((e) => console.warn("Storage delete:", e));
          }
          showToast("❌ File dihapus permanen");
        } catch (err) {
          console.error("Permanent delete failed:", err);
          showToast("Gagal menghapus file permanen");
        }
      };
    });
  }, "recycle");
}

// --- Initial bootstrap & UI polish ---
(function init() {
  breadcrumbs = [{ id: null, name: "Root" }];
  renderBreadcrumbs();
  dropArea.innerHTML = `<p>Tarik & lepas file di sini, atau klik Upload</p><small class="muted">Folder saat ini: Root</small>`;
  showToast("Atlantis NAS siap (updated)");
})();

safeLog("Atlantis NAS updated app.js loaded");
