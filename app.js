// app.js — Atlantis NAS v2.0 (complete)
// Modules (Firebase JS SDK v11 style)
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
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

/* =======================
   CONFIG — sesuaikan kalau perlu
   ======================= */
const firebaseConfig = {
  apiKey: "AIzaSyBdKELW2FNsL7H1zB8R765czcDPaSYybdg",
  authDomain: "atlantis-store.firebaseapp.com",
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

/* =======================
   DOM Refs
   ======================= */
const loginSection = document.getElementById("login-section");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");

const appSection = document.getElementById("app-section");
const userInfo = document.getElementById("user-info");
const logoutBtn = document.getElementById("logout-btn");

const folderForm = document.getElementById("folder-form");
const folderNameInput = document.getElementById("folder-name");
const folderList = document.getElementById("folder-list");

const foldersSection = document.getElementById("folders-section");
const filesSection = document.getElementById("files-section");
const folderTitle = document.getElementById("folder-title");

const uploadBtn = document.getElementById("upload-btn");
const fileInput = document.getElementById("file-input");
const dropArea = document.getElementById("drop-area");
const fileList = document.getElementById("file-list");

const previewModal = document.getElementById("preview-modal");
const previewBody = document.getElementById("preview-body");
const closePreview = document.getElementById("close-preview");
const previewDownload = document.getElementById("preview-download");

const toastEl = document.getElementById("toast");

const globalSearch = document.getElementById("global-search");
const sortSelect = document.getElementById("sort-select");
const tabFiles = document.getElementById("tab-files");
const tabRecycle = document.getElementById("tab-recycle");
const tabSettings = document.getElementById("tab-settings");
const toggleThemeBtn = document.getElementById("toggle-theme");

/* =======================
   App State
   ======================= */
let currentUser = null;
let currentFolderId = null;
let currentFolderName = '';
let filesCache = []; // local snapshot of current folder files (not deleted)
let selectedFiles = new Set();
let uploadTasks = new Map(); // track upload tasks for cancel/resume UI

/* =======================
   Utilities
   ======================= */
function toast(message, timeout = 3000) {
  if (!toastEl) return alert(message);
  toastEl.textContent = message;
  toastEl.style.display = "block";
  setTimeout(() => {
    toastEl.style.display = "none";
  }, timeout);
}

function formatBytes(bytes = 0, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
function escapeHtml(s = '') {
  return s.replace(/[&<>"'`=\/]/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','/':'&#47;'}[c];
  });
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('data-')) e.setAttribute(k, attrs[k]);
    else if (k === 'html') e.innerHTML = attrs[k];
    else e[k] = attrs[k];
  }
  children.flat().forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c instanceof Node) e.appendChild(c);
  });
  return e;
}

/* =======================
   File Icon mapping by MIME/type
   ======================= */
function fileIconFor(file) {
  const mime = (file.contentType || file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return '📄';
  if (mime.startsWith('video/')) return '🎞️';
  if (mime.includes('zip') || name.endsWith('.zip') || name.endsWith('.rar')) return '🗜️';
  if (mime.includes('excel') || name.endsWith('.xls') || name.endsWith('.xlsx')) return '📊';
  if (mime.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return '📃';
  if (mime.includes('presentation') || name.endsWith('.ppt') || name.endsWith('.pptx')) return '📽️';
  if (mime.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) return '📝';
  return '📁';
}

/* =======================
   THEME: auto detect + toggle
   ======================= */
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) document.documentElement.setAttribute('data-theme', 'dark');
  }
}
toggleThemeBtn?.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  if (cur === 'dark') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
});
initTheme();

/* =======================
   AUTH: sign in/out + domain check
   ======================= */
loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles UI
  } catch (err) {
    console.error('Login error:', err);
    loginError.textContent = "Login gagal: " + (err.message || err.code || 'unknown');
  }
});

logoutBtn?.addEventListener('click', async () => {
  await signOut(auth);
  toast('Logged out');
});

onAuthStateChanged(auth, async (user) => {
  if (user && typeof user.email === 'string' && user.email.toLowerCase().endsWith('@atlantis.com')) {
    currentUser = user;
    // show main app
    loginSection.style.display = 'none';
    appSection.style.display = 'flex';
    userInfo.textContent = `${user.email}`;
    await loadFoldersRealtime(); // start listening folders
    // default: show folders
    showTab('files');
    toast(`Selamat datang, ${user.email}`);
  } else {
    // not logged in or not allowed domain
    currentUser = null;
    appSection.style.display = 'none';
    loginSection.style.display = 'flex';
    if (user && !user.email.toLowerCase().endsWith('@atlantis.com')) {
      // quick sign out for other domains
      await signOut(auth);
      loginError.textContent = 'Hanya akun @atlantis.com yang diperbolehkan.';
    }
  }
});

/* =======================
   FOLDERS: load + create + ui
   ======================= */
let foldersUnsub = null;
async function loadFoldersRealtime() {
  // unsubscribe old
  if (foldersUnsub) { foldersUnsub(); foldersUnsub = null; }
  const q = query(collection(db, 'folders'), orderBy('createdAt','desc'));
  foldersUnsub = onSnapshot(q, snapshot => {
    folderList.innerHTML = '';
    snapshot.forEach(docSnap => {
      const f = docSnap.data();
      const id = docSnap.id;
      const card = el('div', { class: 'folder-card', 'data-id': id },
        el('div', { class: 'folder-title' }, `${fileIconFor({name:f.name})} ${escapeHtml(f.name)}`),
        el('div', { class: 'folder-meta' }, f.createdBy || '', ' ', f.createdAt ? '' : '')
      );
      card.addEventListener('click', (ev) => {
        // open folder
        selectFolder(id, f.name);
      });
      folderList.appendChild(card);
    });
  }, (err) => {
    console.error('Folder listen error', err);
  });
}

folderForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = folderNameInput.value.trim();
  if (!name) return;
  try {
    await addDoc(collection(db, 'folders'), { name, createdAt: serverTimestamp(), createdBy: currentUser.email });
    folderNameInput.value = '';
    toast('Folder dibuat');
    logAudit('create_folder', { name });
  } catch (err) {
    console.error(err);
    toast('Gagal membuat folder');
  }
});

/* =======================
   SELECT FOLDER & FILES realtime
   ======================= */
let filesUnsub = null;
function selectFolder(folderId, name) {
  currentFolderId = folderId;
  currentFolderName = name;
  folderTitle.textContent = `📁 ${name}`;
  uploadBtn.disabled = false;
  filesSection.classList.remove('hidden');
  // load files realtime
  if (filesUnsub) filesUnsub();
  const q = query(collection(db, 'files'), where('folderId','==',folderId), orderBy('createdAt','desc'));
  filesUnsub = onSnapshot(q, snapshot => {
    filesCache = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const id = docSnap.id;
      filesCache.push({ id, ...data });
    });
    renderFileList();
  });
}

/* =======================
   RENDER FILE LIST: search, sort, animations
   ======================= */
function renderFileList() {
  // filter deleted out automatically (recycle bin is separate)
  let results = filesCache.filter(f => !f.deleted);
  const q = (globalSearch.value || '').trim().toLowerCase();
  if (q) {
    results = results.filter(f => (f.name || '').toLowerCase().includes(q));
  }
  const sortBy = sortSelect?.value || 'createdAt';
  if (sortBy === 'name') results.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  if (sortBy === 'size') results.sort((a,b)=> (b.size||0) - (a.size||0));
  if (sortBy === 'createdAt') results.sort((a,b)=> (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0) ? (b.createdAt.seconds - a.createdAt.seconds) : 0);

  // clear UI
  fileList.innerHTML = '';

  // create each file row
  results.forEach(f => {
    const row = el('li', { class: 'file-row', 'data-id': f.id },
      el('div', { class: 'file-info' },
        el('input', { type: 'checkbox', class: 'file-checkbox', onchange: () => toggleSelectFile(f.id) }),
        el('div', { class: 'file-icon' }, fileIconFor(f)),
        el('div', { class: 'file-meta' },
          el('div', { class: 'file-name' }, escapeHtml(f.name || '—')),
          el('div', { class: 'file-sub' }, `${formatBytes(f.size||0)} • ${f.contentType || ''}`)
        )
      ),
      el('div', { class: 'file-actions' },
        el('button', { class: 'btn-action preview-btn', title: 'Preview' }, '👁️'),
        el('a', { class: 'btn-action dl', href: f.downloadURL || '#', target: '_blank', rel: 'noreferrer', title: 'Download' }, '⬇️'),
        el('button', { class: 'btn-action rename-btn', title: 'Rename' }, '✏️'),
        el('button', { class: 'btn-action delete-btn', title: 'Delete' }, '🗑️')
      )
    );

    // attach handlers
    row.querySelector('.preview-btn').addEventListener('click', () => previewFile(f));
    row.querySelector('.rename-btn').addEventListener('click', () => renameFilePrompt(f));
    row.querySelector('.delete-btn').addEventListener('click', () => softDeleteFile(f.id));
    // checkbox state maintained by selectedFiles
    const cb = row.querySelector('.file-checkbox');
    if (selectedFiles.has(f.id)) cb.checked = true;
    fileList.appendChild(row);
  });

  // Update small counts, toolbar, etc.
  updateFloatingToolbar();
}

/* =======================
   Selection helpers + floating toolbar
   ======================= */
function toggleSelectFile(id) {
  if (selectedFiles.has(id)) selectedFiles.delete(id); else selectedFiles.add(id);
  updateFloatingToolbar();
}
function clearSelection() {
  selectedFiles.clear();
  // uncheck checkboxes in DOM
  document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = false);
  updateFloatingToolbar();
}
function updateFloatingToolbar() {
  // floating toolbar appears when selection > 0
  const selectedCount = selectedFiles.size;
  // if you want a floating toolbar, create/insert it here; for simplicity we show toast + enable bulk buttons
  const bulkControlsExists = document.getElementById('bulk-controls');
  let bulkControls = bulkControlsExists;
  if (!bulkControls && selectedCount > 0) {
    bulkControls = el('div', { id: 'bulk-controls', class: 'bulk-controls' },
      el('span', {}, `${selectedCount} terpilih`),
      el('button', { id: 'bulk-download' }, '⬇️ Download'),
      el('button', { id: 'bulk-delete' }, '🗑️ Hapus'),
      el('button', { id: 'bulk-clear' }, '✖ Clear')
    );
    document.body.appendChild(bulkControls);
    document.getElementById('bulk-clear').addEventListener('click', () => {
      clearSelection();
      bulkControls.remove();
    });
    document.getElementById('bulk-delete').addEventListener('click', async () => {
      if (!confirm('Hapus file terpilih? (akan masuk Recycle Bin)')) return;
      for (const id of Array.from(selectedFiles)) {
        await softDeleteFile(id);
      }
      clearSelection();
      bulkControls.remove();
      toast('File dipindahkan ke Recycle Bin');
    });
    document.getElementById('bulk-download').addEventListener('click', () => {
      toast('Untuk download banyak file, gunakan fitur Zip server-side (Cloud Function).');
    });
  } else if (bulkControls && selectedCount === 0) {
    bulkControls.remove();
  } else if (bulkControls) {
    bulkControls.querySelector('span').textContent = `${selectedCount} terpilih`;
  }
}

/* =======================
   UPLOAD: drag/drop + per-file progress
   ======================= */
uploadBtn?.addEventListener('click', () => fileInput?.click());

fileInput?.addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  handleUploadFiles(files);
});

// drag/drop
['dragenter','dragover'].forEach(ev => {
  dropArea?.addEventListener(ev, (e) => {
    e.preventDefault();
    dropArea.classList.add('dragover');
  });
});
['dragleave','drop'].forEach(ev => {
  dropArea?.addEventListener(ev, (e) => {
    e.preventDefault();
    dropArea.classList.remove('dragover');
  });
});
dropArea?.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  const files = dt.files;
  if (!files || files.length === 0) return;
  handleUploadFiles(files);
});

async function handleUploadFiles(fileListObj) {
  if (!currentFolderId) { toast('Pilih folder tujuan terlebih dahulu'); return; }
  for (const file of Array.from(fileListObj)) {
    // client side checks
    if (file.size > 1024 * 1024 * 1024) { // 1GB example limit
      toast(`${file.name} terlalu besar (>1GB)`);
      continue;
    }
    // create UI row for uploading
    const uploadingRow = el('div', { class: 'upload-row' },
      el('div', {}, `Uploading ${escapeHtml(file.name)} `),
      el('div', { class: 'progress-bar' },
        el('div', { class: 'progress-fill', style: 'width:0%' })
      ),
      el('button', { class: 'cancel-upload' }, 'Cancel')
    );
    document.body.appendChild(uploadingRow);

    // storage path
    const path = `uploads/${currentFolderId}/${Date.now()}-${file.name}`;
    const sRef = storageRef(storage, path);
    const task = uploadBytesResumable(sRef, file);

    uploadTasks.set(path, task);

    // cancel button
    uploadingRow.querySelector('.cancel-upload').addEventListener('click', () => {
      try { task.cancel(); uploadTasks.delete(path); uploadingRow.remove(); toast('Upload dibatalkan'); } catch(e) { console.warn(e); }
    });

    task.on('state_changed', (snap) => {
      const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      const fill = uploadingRow.querySelector('.progress-fill');
      if (fill) fill.style.width = `${pct}%`;
    }, (err) => {
      console.error('upload error', err);
      uploadingRow.remove();
      toast(`Upload gagal: ${file.name}`);
    }, async () => {
      const url = await getDownloadURL(sRef);
      // write metadata to Firestore
      try {
        await addDoc(collection(db, 'files'), {
          name: file.name,
          folderId: currentFolderId,
          storagePath: path,
          downloadURL: url,
          size: file.size,
          contentType: file.type,
          createdAt: serverTimestamp(),
          createdBy: currentUser.email
        });
        uploadingRow.remove();
        toast(`Upload sukses: ${file.name}`);
        logAudit('upload_file', { name: file.name, folder: currentFolderName });
      } catch (err) {
        console.error('write metadata error', err);
        toast(`Gagal menyimpan metadata: ${file.name}`);
      }
      uploadTasks.delete(path);
    });
  }
}

/* =======================
   Preview modal
   ======================= */
function previewFile(fileObj) {
  previewBody.innerHTML = '';
  previewDownload.href = fileObj.downloadURL || '#';
  previewDownload.setAttribute('download', fileObj.name || 'file');
  if ((fileObj.contentType || '').startsWith('image/')) {
    const img = el('img', { src: fileObj.downloadURL, style: 'max-width:100%;height:auto' });
    previewBody.appendChild(img);
  } else if ((fileObj.contentType || '') === 'application/pdf' || (fileObj.name||'').toLowerCase().endsWith('.pdf')) {
    const iframe = el('iframe', { src: fileObj.downloadURL, style: 'width:100%;height:70vh;border:none' });
    previewBody.appendChild(iframe);
  } else {
    previewBody.innerHTML = `<p>Tidak dapat preview. Silakan download.</p>`;
  }
  previewModal.setAttribute('aria-hidden', 'false');
}
closePreview?.addEventListener('click', () => previewModal.setAttribute('aria-hidden', 'true'));

/* =======================
   Rename + soft delete + restore + perma delete
   ======================= */
async function renameFilePrompt(fileObj) {
  const newName = prompt('Ubah nama file:', fileObj.name);
  if (!newName || newName.trim() === '' || newName === fileObj.name) return;
  try {
    await updateDoc(doc(db, 'files', fileObj.id), { name: newName });
    toast('Nama file diperbarui');
    logAudit('rename_file', { id: fileObj.id, oldName: fileObj.name, newName });
  } catch (err) {
    console.error(err);
    toast('Gagal mengganti nama file');
  }
}

async function softDeleteFile(fileId) {
  if (!confirm('Hapus file ini? Akan dipindahkan ke Recycle Bin')) return;
  try {
    await updateDoc(doc(db, 'files', fileId), { deleted: true, deletedAt: serverTimestamp(), deletedBy: currentUser.email });
    toast('File dipindahkan ke Recycle Bin');
    logAudit('soft_delete', { id: fileId });
  } catch (err) {
    console.error(err);
    toast('Gagal menghapus file');
  }
}

async function restoreFile(fileId) {
  try {
    await updateDoc(doc(db, 'files', fileId), { deleted: false, deletedAt: null, deletedBy: null });
    toast('File dipulihkan');
    logAudit('restore_file', { id: fileId });
  } catch (err) {
    console.error(err);
    toast('Gagal restore file');
  }
}

async function permaDeleteFile(fileId, storagePath) {
  if (!confirm('Hapus permanen file? Tindakan ini tidak bisa dibatalkan.')) return;
  try {
    // delete storage object if path known
    if (storagePath) {
      try { await deleteObject(storageRef(storage, storagePath)); } catch (e) { console.warn('storage delete warn', e); }
    }
    await deleteDoc(doc(db, 'files', fileId));
    toast('File dihapus permanen');
    logAudit('perma_delete', { id: fileId });
  } catch (err) {
    console.error(err);
    toast('Gagal menghapus permanen');
  }
}

/* =======================
   Recycle Bin view (simple)
   ======================= */
tabRecycle?.addEventListener('click', async () => {
  showTab('recycle');
  // fetch deleted files once
  const q = query(collection(db, 'files'), where('deleted', '==', true), orderBy('deletedAt', 'desc'));
  const snap = await getDocs(q);
  fileList.innerHTML = '';
  snap.forEach(docSnap => {
    const f = { id: docSnap.id, ...docSnap.data() };
    const row = el('li', { class: 'file-row deleted' },
      el('div', { class: 'file-info' },
        el('div', { class: 'file-icon' }, fileIconFor(f)),
        el('div', { class: 'file-meta' },
          el('div', { class: 'file-name' }, escapeHtml(f.name || '—')),
          el('div', { class: 'file-sub' }, `Dihapus: ${f.deletedAt ? new Date(f.deletedAt.seconds*1000).toLocaleString() : '-'}`)
        )
      ),
      el('div', { class: 'file-actions' },
        el('button', { class: 'btn-action restore-btn' }, '↩️ Restore'),
        el('button', { class: 'btn-action perma-btn' }, '🗑️ Hapus Permanen')
      )
    );
    row.querySelector('.restore-btn').addEventListener('click', () => restoreFile(f.id));
    row.querySelector('.perma-btn').addEventListener('click', () => permaDeleteFile(f.id, f.storagePath));
    fileList.appendChild(row);
  });
});

/* =======================
   Tabs: show folders/files/settings
   ======================= */
tabFiles?.addEventListener('click', () => showTab('files'));
tabSettings?.addEventListener('click', () => showTab('settings'));

function showTab(name) {
  // set button active classes
  [tabFiles, tabRecycle, tabSettings].forEach(b => b.classList.remove('active'));
  if (name === 'files') tabFiles.classList.add('active');
  if (name === 'recycle') tabRecycle.classList.add('active');
  if (name === 'settings') tabSettings.classList.add('active');

  // show/hide content sections
  foldersSection.style.display = (name === 'files') ? 'block' : 'none';
  filesSection.style.display = (name === 'files' && currentFolderId) ? 'block' : (name === 'files' ? 'none' : filesSection.style.display);
  // if settings, show placeholder
  if (name === 'settings') {
    fileList.innerHTML = '';
    const settingsCard = el('div', { class: 'folder-card' }, el('div', {}, 'Pengaturan akan datang (roles, security rules guidance).'));
    fileList.appendChild(settingsCard);
  }
}

/* =======================
   Audit logging helper
   ======================= */
async function logAudit(action, meta = {}) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      action,
      meta,
      user: currentUser?.email || 'unknown',
      ts: serverTimestamp()
    });
  } catch (err) {
    console.warn('Audit log failed', err);
  }
}

/* =======================
   Misc: search & sort live
   ======================= */
globalSearch?.addEventListener('input', () => renderFileList());
sortSelect?.addEventListener('change', () => renderFileList());

/* =======================
   Keyboard shortcuts (basic)
   ======================= */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // close preview and clear selection
    previewModal?.setAttribute('aria-hidden','true');
    clearSelection();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    globalSearch?.focus();
  }
});

/* =======================
   Initial setup
   ======================= */
document.addEventListener('DOMContentLoaded', () => {
  // initial visibility
  appSection.style.display = 'none';
  loginSection.style.display = 'flex';
  // small UX: clicking folder list when no folders exist shows message
  if (!folderList || folderList.children.length === 0) {
    // nothing — folders will load via realtime listener after auth
  }
});

/* =======================
   NOTE: Advanced features (placeholders)
   =======================
   - Expiring share links: implement via Cloud Function that returns signed URL
   - Zip multiple files: implement Cloud Function to zip and return temporary URL
   - Role management: create 'roles' collection in Firestore to control admin/editor/viewer
   - Security: configure Firestore & Storage security rules to validate domain and roles
   ======================= */
