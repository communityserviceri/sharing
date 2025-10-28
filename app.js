// app.js (module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

/* ---------- Firebase config (tetap) ---------- */
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
const userInfoEl = document.getElementById('user-info');
const logoutBtn = document.getElementById('logout-btn');

const navBtns = Array.from(document.querySelectorAll('.nav-btn'));
const views = {
  folders: document.getElementById('view-folders'),
  files: document.getElementById('view-files'),
  storage: document.getElementById('view-storage'),
  activity: document.getElementById('view-activity')
};
const breadcrumbCurrent = document.getElementById('breadcrumb-current');
const folderGrid = document.getElementById('folder-grid');
const folderForm = document.getElementById('folder-form');
const folderNameInput = document.getElementById('folder-name');

const fileGrid = document.getElementById('file-grid');
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const dragArea = document.getElementById('drag-area');
const folderTitle = document.getElementById('folder-title');

const searchBox = document.getElementById('search-box');
const clearSearch = document.getElementById('clear-search');
const sortSelect = document.getElementById('sort-select');

const selectAllCheckbox = document.getElementById('select-all');
const downloadSelectedBtn = document.getElementById('download-selected');
const deleteSelectedBtn = document.getElementById('delete-selected');

const previewModal = document.getElementById('preview-modal');
const previewBody = document.getElementById('preview-body');
const previewMeta = document.getElementById('preview-meta');
const previewClose = document.getElementById('preview-close');

const storageUsedEl = document.getElementById('storage-used');
const storageUsedText = document.getElementById('storage-used-text');
const storageTotalText = document.getElementById('storage-total-text');
const storageSummary = document.getElementById('storage-summary');
const activityList = document.getElementById('activity-list');

let currentUser = null;
let currentFolder = null; // { id, name }
let foldersCache = [];
let filesCache = []; // local snapshot of file docs
let storageChart = null;

/* ---------- AUTH ---------- */
// For this admin-only app, we require a specific email (as before)
onAuthStateChanged(auth, user => {
  if (user && user.email === 'admin@atlantis.com') {
    currentUser = user;
    userInfoEl.textContent = `Login sebagai: ${user.email}`;
    // default view
    switchView('folders');
    loadFolders();
    loadStorageUsage();
    watchActivity();
  } else {
    // show login prompt
    promptLogin();
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  location.reload();
});

/* ---------- Login Prompt (simple modal using SweetAlert2) ---------- */
function promptLogin() {
  Swal.fire({
    title: 'Login Admin',
    html:
      `<input id="swal-email" class="swal2-input" placeholder="Email" value="admin@atlantis.com">
       <input id="swal-pass" type="password" class="swal2-input" placeholder="Password">`,
    focusConfirm: false,
    preConfirm: async () => {
      const email = document.getElementById('swal-email').value;
      const password = document.getElementById('swal-pass').value;
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        Swal.showValidationMessage(`Login gagal: ${err.message}`);
      }
    },
    allowOutsideClick: false
  });
}

/* ---------- Navigation ---------- */
navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    switchView(view);
  });
});

function switchView(viewKey) {
  Object.values(views).forEach(v => v.classList.remove('view-active'));
  views[viewKey].classList.add('view-active');
  breadcrumbCurrent.textContent = viewKey.charAt(0).toUpperCase() + viewKey.slice(1);
}

/* ---------- Folders ---------- */
async function loadFolders() {
  folderGrid.innerHTML = `<div class="small">Memuat folder...</div>`;
  const q = query(collection(db, 'folders'), orderBy('createdAt', 'desc'));
  onSnapshot(q, snapshot => {
    foldersCache = [];
    folderGrid.innerHTML = '';
    snapshot.forEach(d => {
      const f = { id: d.id, ...d.data() };
      foldersCache.push(f);
      const card = createFolderCard(f);
      folderGrid.appendChild(card);
    });
    if (foldersCache.length === 0) {
      folderGrid.innerHTML = `<div class="small">Belum ada folder. Buat folder baru untuk memulai.</div>`;
    }
  });
}

function createFolderCard(folder) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div>
      <div class="title">${escapeHtml(folder.name)}</div>
      <div class="meta small">Dibuat oleh: ${folder.createdBy || '-'}</div>
    </div>
    <div class="actions">
      <button class="icon-btn" data-action="open" title="Buka folder"><span class="material-icons">open_in_new</span></button>
      <button class="icon-btn" data-action="rename" title="Ubah nama"><span class="material-icons">edit</span></button>
      <button class="icon-btn" data-action="delete" title="Hapus folder"><span class="material-icons">delete</span></button>
    </div>
  `;
  el.querySelector('[data-action="open"]').addEventListener('click', () => {
    openFolder(folder.id, folder.name);
  });
  el.querySelector('[data-action="rename"]').addEventListener('click', () => {
    Swal.fire({
      title: 'Ubah nama folder',
      input: 'text',
      inputValue: folder.name,
      showCancelButton: true,
      preConfirm: async (newName) => {
        if (!newName) throw 'Nama tidak boleh kosong';
        await updateDoc(doc(db, 'folders', folder.id), { name: newName });
        await logActivity('rename-folder', `${folder.name} → ${newName}`);
      }
    });
  });
  el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    const r = await Swal.fire({
      title: `Hapus folder "${folder.name}"?`,
      text: 'Semua file di dalam folder akan dihapus permanen.',
      icon: 'warning',
      showCancelButton: true
    });
    if (r.isConfirmed) {
      await deleteFolderAndContents(folder.id, folder.name);
    }
  });
  return el;
}

folderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = folderNameInput.value.trim();
  if (!name) return;
  await addDoc(collection(db, 'folders'), {
    name,
    createdAt: serverTimestamp(),
    createdBy: currentUser.email
  });
  folderNameInput.value = '';
  await logActivity('create-folder', name);
});

async function deleteFolderAndContents(folderId, folderName) {
  // delete files documents and storage objects
  const q = query(collection(db, 'files'), where('folderId', '==', folderId));
  const snap = await getDocs(q);
  for (const docSnap of snap.docs) {
    const f = docSnap.data();
    try { await deleteObject(storageRef(storage, f.storagePath)); } catch(e){ console.warn('del storage', e) }
    await deleteDoc(doc(db, 'files', docSnap.id));
  }
  await deleteDoc(doc(db, 'folders', folderId));
  await logActivity('delete-folder', folderName);
}

/* ---------- Open Folder & Files ---------- */
async function openFolder(folderId, folderName) {
  currentFolder = { id: folderId, name: folderName };
  folderTitle.textContent = `📁 ${folderName}`;
  switchView('files');
  loadFiles(folderId);
}

/* Load files in folder */
function loadFiles(folderId) {
  fileGrid.innerHTML = `<div class="small">Memuat file...</div>`;
  const baseQ = query(collection(db, 'files'), where('folderId', '==', folderId));
  // re-run onSnapshot to keep UI real-time
  onSnapshot(baseQ, snapshot => {
    filesCache = [];
    fileGrid.innerHTML = '';
    snapshot.forEach(d => {
      const f = { id: d.id, ...d.data() };
      filesCache.push(f);
      const card = createFileCard(f);
      fileGrid.appendChild(card);
    });
    if (filesCache.length === 0) {
      fileGrid.innerHTML = `<div class="small">Folder kosong.</div>`;
    }
  });
}

/* Create file card element */
function createFileCard(f) {
  const el = document.createElement('div');
  el.className = 'card file-row';
  el.innerHTML = `
    <div class="thumb">${fileIconForMime(f.contentType)}</div>
    <div class="info">
      <div class="title">${escapeHtml(f.name)}</div>
      <div class="meta small">${formatBytes(f.size)} • ${new Date(f.createdAt?.toMillis ? f.createdAt.toMillis() : (f.createdAt || Date.now())).toLocaleString()}</div>
    </div>
    <div class="controls">
      <input type="checkbox" data-id="${f.id}" class="select-file" />
      <button class="icon-btn" data-action="preview" title="Preview"><span class="material-icons">visibility</span></button>
      <a class="icon-btn" href="${f.downloadURL}" target="_blank" download title="Unduh"><span class="material-icons">download</span></a>
      <button class="icon-btn" data-action="rename"><span class="material-icons">edit</span></button>
      <button class="icon-btn" data-action="delete"><span class="material-icons">delete</span></button>
    </div>
  `;
  el.querySelector('[data-action="preview"]').addEventListener('click', () => previewFile(f));
  el.querySelector('[data-action="rename"]').addEventListener('click', async () => {
    const { value: newName } = await Swal.fire({
      title: 'Ubah nama file',
      input: 'text',
      inputValue: f.name,
      showCancelButton: true
    });
    if (newName) {
      await updateDoc(doc(db, 'files', f.id), { name: newName });
      await logActivity('rename-file', `${f.name} → ${newName}`);
    }
  });
  el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    const r = await Swal.fire({ title: `Hapus "${f.name}"?`, icon: 'warning', showCancelButton: true });
    if (r.isConfirmed) {
      try { await deleteObject(storageRef(storage, f.storagePath)); } catch(e){ console.warn(e) }
      await deleteDoc(doc(db, 'files', f.id));
      await logActivity('delete-file', f.name);
    }
  });
  return el;
}

/* ---------- Preview ---------- */
previewClose.addEventListener('click', () => { previewModal.style.display = 'none'; previewBody.innerHTML = ''; previewMeta.innerHTML = ''; });

function previewFile(f) {
  previewBody.innerHTML = '';
  previewMeta.innerHTML = `<div class="small">Nama: ${escapeHtml(f.name)} • ${formatBytes(f.size)}</div>`;
  const mime = f.contentType || '';
  if (mime.startsWith('image/')) {
    const img = document.createElement('img'); img.src = f.downloadURL; img.style.maxWidth = '100%'; img.style.borderRadius='8px';
    previewBody.appendChild(img);
  } else if (mime === 'application/pdf') {
    const iframe = document.createElement('iframe'); iframe.src = f.downloadURL; iframe.style.width='100%'; iframe.style.height='640px'; iframe.style.border='none';
    previewBody.appendChild(iframe);
  } else if (mime.startsWith('video/')) {
    const v = document.createElement('video'); v.src = f.downloadURL; v.controls = true; v.style.maxWidth='100%';
    previewBody.appendChild(v);
  } else if (mime.startsWith('audio/')) {
    const a = document.createElement('audio'); a.src = f.downloadURL; a.controls = true;
    previewBody.appendChild(a);
  } else {
    const p = document.createElement('div'); p.className='small'; p.textContent = 'Preview tidak tersedia untuk tipe file ini. Silakan unduh untuk melihatnya.';
    previewBody.appendChild(p);
  }
  previewModal.style.display = 'flex';
}

/* ---------- Upload (drag & drop + file input) ---------- */
uploadBtn.addEventListener('click', () => fileInput.click());

dragArea.addEventListener('dragover', e => { e.preventDefault(); dragArea.style.borderColor = '#cfefff'; });
dragArea.addEventListener('dragleave', e => { dragArea.style.borderColor = '#e6eef8'; });
dragArea.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragArea.style.borderColor = '#e6eef8';
  const files = Array.from(e.dataTransfer.files);
  await handleFilesUpload(files);
});

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  await handleFilesUpload(files);
  fileInput.value = '';
});

async function handleFilesUpload(files) {
  if (!currentFolder) {
    Swal.fire('Pilih folder terlebih dahulu', '', 'info');
    return;
  }
  for (const file of files) {
    await uploadFileToStorage(file, currentFolder.id);
  }
  await logActivity('upload', `${files.length} file ke "${currentFolder.name}"`);
}

/* Upload helper with progress */
async function uploadFileToStorage(file, folderId) {
  const path = `uploads/${folderId}/${Date.now()}-${file.name}`;
  const ref = storageRef(storage, path);
  const task = uploadBytesResumable(ref, file);

  // show temporary progress card
  const progressCard = document.createElement('div');
  progressCard.className = 'card';
  progressCard.innerHTML = `<div class="title">${escapeHtml(file.name)}</div><div class="meta small">Uploading... <span class="upload-progress">0%</span></div><div class="progress-bar" style="height:8px;background:#f1f6fb;border-radius:8px;margin-top:8px"><div style="height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--accent-2));border-radius:8px"></div></div>`;
  fileGrid.prepend(progressCard);
  const barFill = progressCard.querySelector('div > div');

  return new Promise((resolve, reject) => {
    task.on('state_changed', snapshot => {
      const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      progressCard.querySelector('.upload-progress').textContent = `${percent}%`;
      barFill.style.width = percent + '%';
    }, (err) => {
      progressCard.remove();
      Swal.fire('Upload gagal', err.message, 'error');
      reject(err);
    }, async () => {
      const url = await getDownloadURL(ref);
      await addDoc(collection(db, 'files'), {
        name: file.name,
        folderId,
        storagePath: path,
        downloadURL: url,
        size: file.size,
        contentType: file.type,
        createdAt: serverTimestamp(),
        createdBy: currentUser.email
      });
      progressCard.remove();
      resolve();
    });
  });
}

/* ---------- Bulk select / delete / download ---------- */
selectAllCheckbox.addEventListener('change', () => {
  const boxes = Array.from(document.querySelectorAll('.select-file'));
  boxes.forEach(b => b.checked = selectAllCheckbox.checked);
});

downloadSelectedBtn.addEventListener('click', () => {
  const selected = Array.from(document.querySelectorAll('.select-file:checked')).map(cb => cb.closest('.card').querySelector('a').href);
  if (!selected.length) return Swal.fire('Pilih file dulu', '', 'info');
  // open each link in new tab (browser will download)
  selected.forEach(url => window.open(url, '_blank'));
});

deleteSelectedBtn.addEventListener('click', async () => {
  const selectedBoxes = Array.from(document.querySelectorAll('.select-file:checked'));
  if (!selectedBoxes.length) return Swal.fire('Tidak ada file dipilih', '', 'info');
  const ok = await Swal.fire({ title: `Hapus ${selectedBoxes.length} file?`, icon:'warning', showCancelButton:true });
  if (!ok.isConfirmed) return;
  for (const cb of selectedBoxes) {
    const id = cb.dataset.id;
    const f = filesCache.find(x => x.id === id);
    if (!f) continue;
    try { await deleteObject(storageRef(storage, f.storagePath)); } catch(e){ console.warn(e) }
    await deleteDoc(doc(db, 'files', id));
    await logActivity('delete-file', f.name);
  }
  Swal.fire('Selesai', '', 'success');
});

/* ---------- Search & Sort ---------- */
searchBox.addEventListener('input', () => applySearchAndSort());
clearSearch.addEventListener('click', () => { searchBox.value=''; applySearchAndSort(); });

sortSelect.addEventListener('change', () => applySearchAndSort());

function applySearchAndSort() {
  const q = searchBox.value.trim().toLowerCase();
  // if viewing folders
  if (views.folders.classList.contains('view-active')) {
    folderGrid.innerHTML = '';
    let items = [...foldersCache];
    if (q) items = items.filter(f => f.name.toLowerCase().includes(q));
    items.forEach(f => folderGrid.appendChild(createFolderCard(f)));
  } else if (views.files.classList.contains('view-active')) {
    // filter filesCache
    fileGrid.innerHTML = '';
    let items = [...filesCache];
    if (q) items = items.filter(f => f.name.toLowerCase().includes(q));
    // sort
    const s = sortSelect.value;
    items.sort((a,b) => {
      if (s === 'createdAt_desc') return (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0);
      if (s === 'createdAt_asc') return (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0);
      if (s === 'name_asc') return a.name.localeCompare(b.name);
      if (s === 'name_desc') return b.name.localeCompare(a.name);
      if (s === 'size_desc') return (b.size||0) - (a.size||0);
      if (s === 'size_asc') return (a.size||0) - (b.size||0);
      return 0;
    });
    items.forEach(f => fileGrid.appendChild(createFileCard(f)));
  }
}

/* ---------- Storage usage & chart ---------- */
async function loadStorageUsage() {
  // compute sum of sizes from files collection aggregated
  const q = query(collection(db, 'files'));
  onSnapshot(q, snapshot => {
    let total = 0;
    snapshot.forEach(d => {
      const f = d.data();
      total += f.size || 0;
    });
    renderStorage(total);
  });
}

function renderStorage(usedBytes) {
  // for demo assume total 10GB
  const totalBytes = 10 * 1024 * 1024 * 1024;
  const percent = Math.min(100, Math.round((usedBytes / totalBytes) * 100));
  storageUsedEl.style.width = percent + '%';
  storageUsedText.textContent = `${formatBytes(usedBytes)}`;
  storageTotalText.textContent = ` / ${formatBytes(totalBytes)}`;
  storageSummary.textContent = `${percent}% terpakai`;

  // chart
  const ctx = document.getElementById('storage-chart').getContext('2d');
  const used = usedBytes;
  const free = Math.max(0, totalBytes - used);
  if (storageChart) storageChart.destroy();
  storageChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Used', 'Free'],
      datasets: [{ data: [used, free] }]
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      maintainAspectRatio: false
    }
  });
}

/* ---------- Activity log ---------- */
async function logActivity(type, note) {
  try {
    await addDoc(collection(db, 'activity'), {
      type, note, by: currentUser?.email||'system', at: serverTimestamp()
    });
  } catch(e){ console.warn('log act err', e) }
}

function watchActivity() {
  const q = query(collection(db, 'activity'), orderBy('at', 'desc'), limit(50));
  onSnapshot(q, snap => {
    activityList.innerHTML = '';
    snap.forEach(d => {
      const a = d.data();
      const li = document.createElement('li');
      li.className = 'activity-item';
      li.innerHTML = `<div><strong>${escapeHtml(a.type)}</strong><div class="small">${escapeHtml(a.note || '')}</div></div><div class="small">${a.by || '-'} • ${a.at?.toDate ? a.at.toDate().toLocaleString() : ''}</div>`;
      activityList.appendChild(li);
    });
  });
}

/* ---------- Helpers ---------- */
function fileIconForMime(mime){
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '<span class="material-icons">image</span>';
  if (mime.startsWith('video/')) return '<span class="material-icons">videocam</span>';
  if (mime === 'application/pdf') return '<span class="material-icons">picture_as_pdf</span>';
  if (mime.startsWith('audio/')) return '<span class="material-icons">audiotrack</span>';
  return '<span class="material-icons">insert_drive_file</span>';
}
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024, dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
function escapeHtml(s){ if(!s) return ''; return s.replaceAll('<','&lt;').replaceAll('>','&gt;'); }
