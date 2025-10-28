// app.js — improved / polished version
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  listAll
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

/* ---------- Firebase config (dari upload user) ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyBdKELW2FNsL7H1zB8R765czcDPaSYybdg",
  authDomain: "atlantis-store.firebaseapp.com",
  databaseURL: "https://atlantis-store-default-rtdb.firebaseio.com",
  projectId: "atlantis-store",
  storageBucket: "atlantis-store.appspot.com",
  messagingSenderId: "566295949160",
  appId: "1:566295949160:web:2edd2bd1c4b74277a5f0dd",
  measurementId: "G-ERXQQKY7HM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

/* ---------- DOM ---------- */
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const loginSection = document.getElementById("login-section");

const appSection = document.getElementById("app-section");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const topActions = document.getElementById("top-actions");

const folderForm = document.getElementById("folder-form");
const newFolderToggle = document.getElementById("new-folder-toggle");
const folderCancel = document.getElementById("folder-cancel");
const folderNameInput = document.getElementById("folder-name");
const folderList = document.getElementById("folder-list");
const folderSearch = document.getElementById("folder-search");
const folderTitle = document.getElementById("folder-title");

const fileList = document.getElementById("file-list");
const fileInput = document.getElementById("file-input");
const uploadBtnLabel = document.querySelector(".btn-upload");
const uploadProgress = document.getElementById("upload-progress");
const uploadProgressBar = document.getElementById("upload-progress-bar");
const dropZone = document.getElementById("drop-zone");
const fileSearch = document.getElementById("file-search");
const clearSelection = document.getElementById("clear-selection");

const previewModal = document.getElementById("preview-modal");
const previewBody = document.getElementById("preview-body");
const previewClose = document.getElementById("preview-close");

const renameModal = document.getElementById("rename-modal");
const renameClose = document.getElementById("rename-close");
const renameForm = document.getElementById("rename-form");
const renameInput = document.getElementById("rename-input");

const toastEl = document.getElementById("toast");

let currentUser = null;
let currentFolder = null;
let foldersCache = []; // local mirror for search
let filesCache = []; // local mirror for search
let currentRenameItem = null;

/* ---------- Helpers ---------- */
const showToast = (msg, time = 3500) => {
  toastEl.hidden = false;
  toastEl.textContent = msg;
  setTimeout(() => toastEl.hidden = true, time);
};

const formatBytes = (bytes) => {
  if (!bytes) return '-';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed( (i===0?0:1) )} ${units[i]}`;
};

const formatDate = (ts) => {
  try {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('id-ID');
  } catch { return '-'; }
};

/* ---------- AUTH ---------- */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
  } catch (err) {
    loginError.textContent = "Login gagal: " + err.message;
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

/* ---------- AUTH STATE ---------- */
onAuthStateChanged(auth, (user) => {
  if (user && user.email === "admin@atlantis.com") {
    currentUser = user;
    loginSection.style.display = "none";
    appSection.style.display = "grid";
    topActions.setAttribute("aria-hidden", "false");
    userInfo.textContent = user.email;
    loadFolders();
  } else {
    currentUser = null;
    loginSection.style.display = "block";
    appSection.style.display = "none";
    topActions.setAttribute("aria-hidden", "true");
  }
});

/* ---------- FOLDERS ---------- */
function loadFolders() {
  const q = query(collection(db, "folders"), orderBy("createdAt", "desc"));
  onSnapshot(q, snapshot => {
    foldersCache = [];
    folderList.innerHTML = "";
    snapshot.forEach(snap => {
      const data = snap.data();
      foldersCache.push({ id: snap.id, ...data });
    });
    renderFolders();
  }, err => showToast("Error load folders: " + err.message));
}

function renderFolders(filter = "") {
  folderList.innerHTML = "";
  const filtered = foldersCache.filter(f => f.name.toLowerCase().includes(filter.toLowerCase()));
  if (filtered.length === 0) {
    folderList.innerHTML = `<li class="muted">Tidak ada folder</li>`;
    return;
  }
  for (const f of filtered) {
    const li = document.createElement("li");
    li.className = "folder-item";
    li.innerHTML = `
      <div class="meta" title="${f.name}">
        <div><strong>${f.name}</strong><br/><small>${formatDate(f.createdAt)}</small></div>
      </div>
      <div class="row">
        <button class="btn-ghost btn-sm" data-id="${f.id}" data-name="${f.name}" aria-label="rename">✏️</button>
        <button class="btn-ghost btn-sm" data-del="${f.id}" aria-label="delete">🗑️</button>
      </div>
    `;
    li.addEventListener("click", (ev) => {
      // clicking on buttons should not select
      if (ev.target.closest("button")) return;
      selectFolder(f.id, f.name);
    });
    // rename button
    li.querySelector('[data-id]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      openRenameFolderModal(f);
    });
    li.querySelector('[data-del]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFolderConfirmed(f.id, f.name);
    });
    folderList.appendChild(li);
  }
}

newFolderToggle.addEventListener("click", () => {
  folderForm.style.display = folderForm.style.display === "none" ? "flex" : "none";
});
folderCancel.addEventListener("click", () => folderForm.style.display = "none");

folderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = folderNameInput.value.trim();
  if (!name) return;
  try {
    await addDoc(collection(db, "folders"), {
      name,
      createdAt: serverTimestamp(),
      createdBy: currentUser.email
    });
    folderNameInput.value = "";
    folderForm.style.display = "none";
    showToast("Folder dibuat");
  } catch (err) {
    showToast("Gagal membuat folder: " + err.message);
  }
});

/* ---------- SELECT FOLDER & FILES ---------- */
async function selectFolder(folderId, name) {
  currentFolder = folderId;
  folderTitle.textContent = "📁 " + name;
  uploadBtnLabel.style.display = "";
  loadFiles(folderId);
}

function loadFiles(folderId) {
  const q = query(collection(db, "files"), where("folderId", "==", folderId), orderBy("createdAt", "desc"));
  onSnapshot(q, snapshot => {
    filesCache = [];
    fileList.innerHTML = "";
    snapshot.forEach(snap => {
      const d = snap.data();
      filesCache.push({ id: snap.id, ...d });
    });
    renderFiles();
  }, err => showToast("Gagal load files: " + err.message));
}

function renderFiles(filter = "") {
  fileList.innerHTML = "";
  const filtered = filesCache.filter(f => f.name.toLowerCase().includes(filter.toLowerCase()));
  if (filtered.length === 0) {
    fileList.innerHTML = `<li class="muted">Tidak ada file</li>`;
    return;
  }
  for (const f of filtered) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="meta">
        <div class="name">${f.name}</div>
        <div class="sub">${formatBytes(f.size)} • ${f.contentType || '-'} • ${formatDate(f.createdAt)}</div>
      </div>
      <div class="row">
        <a class="btn-ghost btn-sm" href="${f.downloadURL}" target="_blank" rel="noopener">🔗</a>
        <button class="btn-ghost btn-sm preview" data-id="${f.id}">👁️</button>
        <button class="btn-ghost btn-sm rename-file" data-id="${f.id}" data-name="${f.name}">✏️</button>
        <button class="btn-ghost btn-sm delete-file" data-id="${f.id}" data-path="${f.storagePath}">🗑️</button>
      </div>
    `;
    // preview
    li.querySelector(".preview")?.addEventListener("click", () => openPreview(f));
    // rename
    li.querySelector(".rename-file")?.addEventListener("click", () => openRenameFileModal(f));
    // delete
    li.querySelector(".delete-file")?.addEventListener("click", () => deleteFileConfirmed(f.id, f.storagePath));
    fileList.appendChild(li);
  }
}

/* ---------- UPLOAD ---------- */
uploadBtnLabel.addEventListener("click", (e) => {
  if (!currentFolder) {
    showToast("Pilih folder dulu");
    e.preventDefault();
  }
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentFolder) return;
  await uploadFile(file);
  fileInput.value = "";
});

// drag & drop
;['dragenter','dragover'].forEach(ev => {
  dropZone.addEventListener(ev, (e)=>{ e.preventDefault(); dropZone.classList.add('dragover'); });
});
;['dragleave','drop'].forEach(ev => {
  dropZone.addEventListener(ev, (e)=>{ e.preventDefault(); dropZone.classList.remove('dragover'); });
});
dropZone.addEventListener("drop", async (e) => {
  const file = e.dataTransfer.files?.[0];
  if (!file) return;
  if (!currentFolder) { showToast("Pilih folder dulu"); return; }
  await uploadFile(file);
});

async function uploadFile(file) {
  try {
    uploadProgress.hidden = false;
    uploadProgressBar.style.width = '0%';
    const path = `uploads/${currentFolder}/${Date.now()}-${file.name}`;
    const ref = storageRef(storage, path);
    const task = uploadBytesResumable(ref, file);
    task.on('state_changed', snapshot => {
      const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      uploadProgressBar.style.width = `${progress}%`;
    }, (err) => {
      showToast("Upload error: " + err.message);
      uploadProgress.hidden = true;
    }, async () => {
      const url = await getDownloadURL(ref);
      await addDoc(collection(db, "files"), {
        name: file.name,
        folderId: currentFolder,
        storagePath: path,
        downloadURL: url,
        size: file.size,
        contentType: file.type,
        createdAt: serverTimestamp(),
        createdBy: currentUser.email
      });
      uploadProgressBar.style.width = `100%`;
      setTimeout(()=> uploadProgress.hidden = true, 600);
      showToast("Upload berhasil");
    });
  } catch (err) {
    showToast("Gagal upload: " + err.message);
    uploadProgress.hidden = true;
  }
}

/* ---------- PREVIEW ---------- */
function openPreview(file) {
  previewBody.innerHTML = '';
  const url = file.downloadURL;
  if (!url) { showToast("Tidak ada preview"); return; }
  // image types
  if (file.contentType && file.contentType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.style.maxWidth = '90vw';
    img.style.maxHeight = '80vh';
    previewBody.appendChild(img);
  } else if (file.contentType === 'application/pdf' || file.name.endsWith('.pdf')) {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.width = '90vw';
    iframe.style.height = '80vh';
    previewBody.appendChild(iframe);
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Buka file di tab baru';
    previewBody.appendChild(a);
  }
  previewModal.hidden = false;
}
previewClose.addEventListener('click', ()=> previewModal.hidden = true);

/* ---------- RENAME MODALS ---------- */
function openRenameFolderModal(folder) {
  currentRenameItem = { type: 'folder', id: folder.id };
  renameInput.value = folder.name;
  renameModal.hidden = false;
}

function openRenameFileModal(file) {
  currentRenameItem = { type: 'file', id: file.id };
  renameInput.value = file.name;
  renameModal.hidden = false;
}

renameClose.addEventListener('click', ()=> renameModal.hidden = true);

renameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const newName = renameInput.value.trim();
  if (!newName || !currentRenameItem) return;
  try {
    if (currentRenameItem.type === 'folder') {
      await updateDoc(doc(db, "folders", currentRenameItem.id), { name: newName });
      showToast("Nama folder diubah");
    } else {
      await updateDoc(doc(db, "files", currentRenameItem.id), { name: newName });
      showToast("Nama file diubah");
    }
  } catch (err) {
    showToast("Gagal rename: " + err.message);
  } finally {
    renameModal.hidden = true;
    currentRenameItem = null;
  }
});

/* ---------- DELETE ---------- */
async function deleteFileConfirmed(id, storagePath) {
  if (!confirm("Hapus file ini?")) return;
  try {
    if (storagePath) await deleteObject(storageRef(storage, storagePath));
    await deleteDoc(doc(db, "files", id));
    showToast("File dihapus");
  } catch (err) {
    showToast("Gagal hapus file: " + err.message);
  }
}

async function deleteFolderConfirmed(folderId, folderName) {
  if (!confirm(`Hapus folder "${folderName}" beserta semua file di dalamnya?`)) return;
  try {
    // get files in folder
    const q = query(collection(db, "files"), where("folderId", "==", folderId));
    const snap = await getDocs(q);
    // delete storage objects + docs
    for (const docSnap of snap.docs) {
      const f = docSnap.data();
      if (f.storagePath) {
        try { await deleteObject(storageRef(storage, f.storagePath)); } catch (e) { console.warn("storage delete error", e); }
      }
      await deleteDoc(doc(db, "files", docSnap.id));
    }
    // delete folder doc
    await deleteDoc(doc(db, "folders", folderId));
    showToast("Folder dan isinya dihapus");
    // if we deleted currently selected folder, clear UI
    if (currentFolder === folderId) {
      currentFolder = null;
      folderTitle.textContent = "🗂 Pilih Folder";
      fileList.innerHTML = "";
    }
  } catch (err) {
    showToast("Gagal hapus folder: " + err.message);
  }
}

/* ---------- SEARCH ---------- */
folderSearch.addEventListener('input', (e)=> renderFolders(e.target.value));
fileSearch.addEventListener('input', (e)=> renderFiles(e.target.value));

/* ---------- UTILITY ---------- */
clearSelection.addEventListener('click', ()=> {
  currentFolder = null;
  folderTitle.textContent = "🗂 Pilih Folder";
  fileList.innerHTML = "";
  showToast("Folder dibersihkan");
});

/* ---------- Accessibility / small improvements ---------- */
// Close modals with escape
window.addEventListener('keydown', (e)=> {
  if (e.key === 'Escape') {
    if (!previewModal.hidden) previewModal.hidden = true;
    if (!renameModal.hidden) renameModal.hidden = true;
  }
});

// initial hidden states
uploadProgress.hidden = true;
previewModal.hidden = true;
renameModal.hidden = true;
toastEl.hidden = true;
