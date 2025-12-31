// === Atlantis NAS — app.js (Professional UI Version) ===
// Logic kept intact, rendering updated for Data Grid Layout.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  set,
  onValue,
  get,
  query,
  orderByChild,
  equalTo,
  update,
  remove,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// --- Config (KEEP YOUR ORIGINAL CONFIG) ---
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

// --- App state ---
let currentUser = null;
let currentUserRole = "staff";
let currentFolder = null;
let folderListenerUnsub = null;
let fileListenerUnsub = null;
let breadcrumbs = [];
let activeTab = "files";
let foldersCache = {}; 

// --- DOM Refs (Updated IDs) ---
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

// Mobile refs
const sidebar = document.querySelector(".sidebar");
const menuToggle = document.getElementById("menu-toggle");
const menuOverlay = document.getElementById("menu-overlay");

// --- UI Helpers ---
function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = "block";
  toast.style.animation = "slideUp 0.3s ease";
  setTimeout(() => {
    toast.style.display = "none";
  }, 3000);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "-";
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleDateString('id-ID', { 
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
  });
}

function el(tag, cls = "", attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

// --- Menu Toggle ---
if (menuToggle) {
    menuToggle.onclick = () => {
        sidebar.classList.toggle('open');
        menuOverlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
    };
}
if (menuOverlay) {
    menuOverlay.onclick = () => {
        sidebar.classList.remove('open');
        menuOverlay.style.display = 'none';
    };
}

// --- AUTH ---
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "Authenticating...";
  try {
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passInput.value.trim());
  } catch (err) {
    loginError.textContent = "Access Denied: " + err.message;
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("user-info").textContent = user.email;
    settingsEmail.value = user.email;
    loginSection.style.display = "none";
    appSection.removeAttribute("aria-hidden");
    
    // Check Role
    const snap = await get(ref(db, `users/${user.uid}/role`));
    currentUserRole = snap.exists() ? snap.val() : "staff";
    document.querySelector('.user-role-badge').textContent = currentUserRole.toUpperCase();

    breadcrumbs = [{ id: null, name: "Home" }];
    activeTab = "files";
    
    renderBreadcrumbs();
    updateTabUI();
    loadFoldersRealtime();
    loadFilesRealtime();
  } else {
    currentUser = null;
    appSection.setAttribute("aria-hidden", "true");
    loginSection.style.display = "flex";
  }
});

// --- Tabs UI ---
function updateTabUI() {
  [tabFiles, tabRecycle, tabSettings].forEach(t => t.classList.remove('active'));
  
  if (activeTab === 'files') {
      tabFiles.classList.add('active');
      document.querySelector('.content-wrapper').style.display = 'flex';
      settingsPanel.setAttribute('aria-hidden', 'true');
      loadFoldersRealtime();
      loadFilesRealtime();
  } else if (activeTab === 'recycle') {
      tabRecycle.classList.add('active');
      document.querySelector('.content-wrapper').style.display = 'flex';
      settingsPanel.setAttribute('aria-hidden', 'true');
      loadRecycleBin();
  } else if (activeTab === 'settings') {
      tabSettings.classList.add('active');
      settingsPanel.setAttribute('aria-hidden', 'false');
  }
}
tabFiles.onclick = () => { activeTab = "files"; updateTabUI(); };
tabRecycle.onclick = () => { activeTab = "recycle"; updateTabUI(); };
tabSettings.onclick = () => { activeTab = "settings"; updateTabUI(); };

document.getElementById('close-settings').onclick = () => {
    activeTab = "files";
    updateTabUI();
};

// --- Breadcrumbs ---
function renderBreadcrumbs() {
  const bcContainer = document.getElementById("breadcrumb");
  bcContainer.innerHTML = "";
  breadcrumbs.forEach((b, idx) => {
    const btn = el("button", "crumb");
    btn.textContent = b.name;
    btn.onclick = () => {
      breadcrumbs = breadcrumbs.slice(0, idx + 1);
      currentFolder = b.id || null;
      renderBreadcrumbs();
      loadFoldersRealtime();
      loadFilesRealtime();
      folderTitle.textContent = b.name;
    };
    // Add separator if not last
    bcContainer.appendChild(btn);
    if(idx < breadcrumbs.length - 1) {
        const sep = document.createElement('span');
        sep.textContent = '/';
        sep.style.color = 'var(--text-muted)';
        sep.style.fontSize = '0.8rem';
        bcContainer.appendChild(sep);
    }
  });
}

// --- Render Helper: File Row (Table Format) ---
function createFileRow(file, id, isRecycle = false) {
    const li = el("li", "file-row");
    li.dataset.id = id;
    li.draggable = !isRecycle;

    // Icon based on file type (basic logic)
    let icon = "📄";
    const name = file.name.toLowerCase();
    if (name.endsWith('.png') || name.endsWith('.jpg')) icon = "🖼️";
    if (name.endsWith('.pdf')) icon = "📕";
    if (name.endsWith('.zip')) icon = "📦";

    if (isRecycle) {
        li.innerHTML = `
            <div class="col-check">🗑️</div>
            <div class="col-name" title="${file.name}">${icon} ${file.name}</div>
            <div class="col-size">${formatBytes(file.size)}</div>
            <div class="col-date">${formatDate(file.deletedAt)}</div>
            <div class="col-action">
                <button class="btn icon-only" data-restore="${id}" title="Restore">♻️</button>
                <button class="btn icon-only danger" data-permadelete="${id}" data-path="${file.storagePath}" title="Delete Forever">✕</button>
            </div>
        `;
    } else {
        li.innerHTML = `
            <div class="col-check"><input type="checkbox" class="file-checkbox" data-id="${id}"></div>
            <div class="col-name" title="${file.name}">${icon} ${file.name}</div>
            <div class="col-size">${formatBytes(file.size)}</div>
            <div class="col-date">${formatDate(file.createdAt)}</div>
            <div class="col-action">
                <button class="btn icon-only" data-preview="${file.url}" title="Preview">👁️</button>
                <button class="btn icon-only text-danger" data-delete="${id}" title="Delete">🗑️</button>
            </div>
        `;
    }

    // Drag start
    if(!isRecycle) {
        li.ondragstart = (e) => e.dataTransfer.setData("text/plain", id);
    }

    return li;
}

// --- Folders Realtime ---
function loadFoldersRealtime() {
  if (!currentUser) return;
  if (folderListenerUnsub) folderListenerUnsub();

  const q = query(ref(db, "folders"), orderByChild("parentId"), equalTo(currentFolder || null));
  folderListenerUnsub = onValue(q, (snapshot) => {
    folderList.innerHTML = "";
    const data = snapshot.val() || {};
    foldersCache = { ...foldersCache, ...data };

    Object.entries(data).forEach(([id, f]) => {
      // Simplified permission check
      if (f.division !== 'shared' && f.access?.read && !f.access.read[currentUserRole] && currentUserRole !== 'admin') return;

      const div = el("div", "folder-card");
      div.innerHTML = `
        <span>📁 ${f.name}</span>
        <small style="color:var(--text-muted)">${f.fileCount || 0}</small>
      `;
      div.onclick = () => {
        breadcrumbs.push({ id, name: f.name });
        currentFolder = id;
        renderBreadcrumbs();
        loadFoldersRealtime();
        loadFilesRealtime();
        folderTitle.textContent = f.name;
        dropArea.innerHTML = `<div class="drop-content"><span class="drop-icon">📂</span><p>Add to ${f.name}</p></div>`;
      };
      // Drag events
      div.ondragover = (e) => { e.preventDefault(); div.classList.add("drag-over"); };
      div.ondragleave = () => div.classList.remove("drag-over");
      div.ondrop = (e) => handleMoveFiles(e, id);

      folderList.appendChild(div);
    });
  });
}

// --- Files Realtime ---
function loadFilesRealtime() {
  if (!currentUser) return;
  if (fileListenerUnsub) fileListenerUnsub();

  const q = query(ref(db, "files"), orderByChild("folderId"), equalTo(currentFolder || null));
  
  fileListenerUnsub = onValue(q, (snapshot) => {
    fileList.innerHTML = "";
    const files = snapshot.val() || {};
    
    // Sort locally by created desc
    const sorted = Object.entries(files).sort(([,a], [,b]) => b.createdAt - a.createdAt);

    sorted.forEach(([id, f]) => {
      if (f.deleted) return;
      // Basic permission: if not owner and folder not shared, strict check (simplified for UI demo)
      if(f.owner !== currentUser.email && currentUserRole !== 'admin' && currentUserRole !== 'staff') {
          // In real app, check folder permissions here
      }

      const row = createFileRow(f, id, false);
      fileList.appendChild(row);
    });

    attachFileHandlers();
  });
}

function loadRecycleBin() {
    if (fileListenerUnsub) fileListenerUnsub();
    const q = query(ref(db, "files"), orderByChild("deleted"), equalTo(true));
    fileListenerUnsub = onValue(q, (snapshot) => {
        fileList.innerHTML = "";
        const files = snapshot.val() || {};
        Object.entries(files).forEach(([id, f]) => {
            const row = createFileRow(f, id, true);
            fileList.appendChild(row);
        });
        attachRecycleHandlers();
    });
}

// --- Handlers ---
function attachFileHandlers() {
    // Checkbox logic
    const checkboxes = fileList.querySelectorAll('.file-checkbox');
    const bulkToolbar = document.getElementById('header-bulk-actions');
    
    checkboxes.forEach(cb => {
        cb.onchange = () => {
            const anyChecked = Array.from(checkboxes).some(c => c.checked);
            bulkToolbar.style.opacity = anyChecked ? "1" : "0.5";
            bulkToolbar.style.pointerEvents = anyChecked ? "auto" : "none";
        };
    });

    // Preview
    fileList.querySelectorAll('[data-preview]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation(); // prevent row click
            window.previewFile(btn.dataset.preview);
        };
    });

    // Soft Delete
    fileList.querySelectorAll('[data-delete]').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            if(confirm("Move to Recycle Bin?")) {
                await update(ref(db, `files/${btn.dataset.delete}`), { deleted: true, deletedAt: Date.now() });
                showToast("Item moved to Recycle Bin");
            }
        };
    });
}

function attachRecycleHandlers() {
    // Restore
    fileList.querySelectorAll('[data-restore]').forEach(btn => {
        btn.onclick = async () => {
            await update(ref(db, `files/${btn.dataset.restore}`), { deleted: false, deletedAt: null });
            showToast("File Restored");
        };
    });
    // Permadelete
    fileList.querySelectorAll('[data-permadelete]').forEach(btn => {
        btn.onclick = async () => {
            if(confirm("Permanently delete? Cannot undo.")) {
                await remove(ref(db, `files/${btn.dataset.permadelete}`));
                // storage delete optional for demo safety
            }
        };
    });
}

// --- Upload & Move Logic (Simplified Wrapper) ---
uploadBtn.onclick = () => fileInput.click();
fileInput.onchange = (e) => handleUpload(e.target.files);

dropArea.ondragover = (e) => { e.preventDefault(); dropArea.classList.add('dragover'); };
dropArea.ondragleave = () => dropArea.classList.remove('dragover');
dropArea.ondrop = (e) => { e.preventDefault(); dropArea.classList.remove('dragover'); handleUpload(e.dataTransfer.files); };

function handleUpload(files) {
    if(!files.length) return;
    showToast(`Uploading ${files.length} file(s)...`);
    Array.from(files).forEach(file => {
        const path = `${currentUser.uid}/${Date.now()}_${file.name}`;
        const task = uploadBytesResumable(storageRef(storage, path), file);
        task.then(async (snap) => {
            const url = await getDownloadURL(snap.ref);
            await push(ref(db, "files"), {
                name: file.name, size: file.size, folderId: currentFolder,
                owner: currentUser.email, storagePath: path, url,
                createdAt: Date.now(), deleted: false
            });
            showToast("Upload Complete");
        }).catch(e => showToast("Upload Failed"));
    });
}

async function handleMoveFiles(e, targetId) {
    e.preventDefault();
    const fileId = e.dataTransfer.getData("text/plain");
    if(fileId && confirm("Move file here?")) {
        await update(ref(db, `files/${fileId}`), { folderId: targetId });
        showToast("File Moved");
    }
}

// --- Preview Modal ---
window.previewFile = (url) => {
    const modal = document.getElementById("preview-modal");
    document.getElementById("preview-body").innerHTML = `<iframe src="${url}" width="100%" height="100%" style="border:0"></iframe>`;
    document.getElementById("preview-download").href = url;
    modal.setAttribute("aria-hidden", "false");
};
document.getElementById("close-preview").onclick = () => document.getElementById("preview-modal").setAttribute("aria-hidden", "true");

// --- Theme Init ---
const savedTheme = localStorage.getItem("theme") || "light";
document.documentElement.dataset.theme = savedTheme;
settingsTheme.value = savedTheme;
settingsTheme.onchange = (e) => {
    document.documentElement.dataset.theme = e.target.value;
    localStorage.setItem("theme", e.target.value);
};

// --- Create Folder ---
folderForm.onsubmit = async (e) => {
    e.preventDefault();
    if(!folderInput.value) return;
    await push(ref(db, "folders"), {
        name: folderInput.value, parentId: currentFolder,
        createdAt: Date.now(), division: currentUserRole, fileCount: 0
    });
    folderInput.value = "";
    showToast("Folder Created");
};
