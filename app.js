// === Atlantis NAS v3.0 Enhanced ===
// Firebase + UI logic
// ----------------------------------

// 🔥 Firebase init
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
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
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// Config Firebase kamu di sini 👇
const firebaseConfig = {
  apiKey: "ISI_APIKEY_KAMU",
  authDomain: "ISI.firebaseapp.com",
  projectId: "ISI",
  storageBucket: "ISI.appspot.com",
  messagingSenderId: "ISI",
  appId: "ISI"
};

// Initialize
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null;
let currentFolder = null;

// === UI References ===
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
const dropArea = document.getElementById("drop-area");
const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");

const toast = document.getElementById("toast");
const globalSearch = document.getElementById("global-search");
const filterType = document.getElementById("filter-type");
const sortSelect = document.getElementById("sort-select");
const folderTitle = document.getElementById("folder-title");

// === Auth ===
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passInput.value.trim();
  if (!email.endsWith("@atlantis.com")) {
    loginError.textContent = "Gunakan email @atlantis.com";
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    loginError.textContent = "";
  } catch (err) {
    loginError.textContent = "Gagal login: " + err.message;
  }
});

logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("user-info").textContent = user.email;
    loginSection.style.display = "none";
    appSection.removeAttribute("aria-hidden");
    loadFoldersRealtime();
  } else {
    currentUser = null;
    appSection.setAttribute("aria-hidden", "true");
    loginSection.style.display = "flex";
  }
});

// === Folders ===
async function loadFoldersRealtime() {
  const q = query(
    collection(db, "folders"),
    where("createdBy", "==", currentUser.email),
    orderBy("createdAt", "desc")
  );
  onSnapshot(q, (snap) => {
    folderList.innerHTML = "";
    snap.forEach((docu) => {
      const f = docu.data();
      const div = document.createElement("div");
      div.className = "folder-card";
      div.dataset.id = docu.id;
      div.innerHTML = `
        <span>📁 ${f.name}</span>
        <small class="small-muted">${f.fileCount || 0} file</small>`;
      div.onclick = () => openFolder(docu.id, f.name);
      div.ondragover = (e) => {
        e.preventDefault();
        div.classList.add("drag-over");
      };
      div.ondragleave = () => div.classList.remove("drag-over");
      div.ondrop = (e) => handleMoveFiles(e, docu.id);
      folderList.appendChild(div);
    });
  });
}

folderForm.onsubmit = async (e) => {
  e.preventDefault();
  const name = folderInput.value.trim();
  if (!name) return;
  await addDoc(collection(db, "folders"), {
    name,
    createdBy: currentUser.email,
    createdAt: serverTimestamp(),
    fileCount: 0
  });
  folderInput.value = "";
  showToast("Folder dibuat!");
};

// === Files ===
async function openFolder(id, name) {
  currentFolder = id;
  folderTitle.textContent = "📂 " + name;
  uploadBtn.disabled = false;

  const q = query(
    collection(db, "files"),
    where("folderId", "==", id),
    where("owner", "==", currentUser.email)
  );
  onSnapshot(q, (snap) => {
    fileList.innerHTML = "";
    snap.forEach((docu) => {
      const f = docu.data();
      const li = document.createElement("li");
      li.className = "file-row";
      li.draggable = true;
      li.dataset.id = docu.id;
      li.innerHTML = `
        <div class="file-info">
          <input type="checkbox" class="select-file" data-id="${docu.id}" />
          <div class="file-meta">
            <span class="file-name">${f.name}</span>
            <span class="file-sub">${formatBytes(f.size)} • ${new Date(
        f.createdAt?.seconds * 1000
      ).toLocaleString()}</span>
          </div>
        </div>
        <div class="file-actions">
          <button onclick="previewFile('${f.url}')">👁️</button>
          <button onclick="deleteFile('${docu.id}', '${f.storagePath}')">🗑️</button>
        </div>`;
      li.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", docu.id);
      };
      fileList.appendChild(li);
    });
  });
}

// === Upload ===
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
  [...files].forEach((file) => {
    const path = `${currentUser.uid}/${currentFolder}/${file.name}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);

    const row = document.createElement("li");
    row.className = "file-row";
    row.textContent = `⬆️ Mengunggah ${file.name}...`;
    fileList.prepend(row);

    task.on(
      "state_changed",
      (snap) => {
        const percent = Math.round(
          (snap.bytesTransferred / snap.totalBytes) * 100
        );
        row.textContent = `⬆️ ${file.name} (${percent}%)`;
      },
      (err) => {
        showToast("Upload gagal: " + err.message);
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        await addDoc(collection(db, "files"), {
          name: file.name,
          size: file.size,
          folderId: currentFolder,
          owner: currentUser.email,
          storagePath: path,
          url,
          createdAt: serverTimestamp()
        });
        showToast("✅ Upload selesai: " + file.name);
      }
    );
  });
}

// === Delete file ===
window.deleteFile = async (id, path) => {
  if (!confirm("Hapus file ini?")) return;
  await deleteDoc(doc(db, "files", id));
  await deleteObject(ref(storage, path));
  showToast("File dihapus.");
};

// === Move file (drag-drop antar folder) ===
async function handleMoveFiles(e, targetFolderId) {
  e.preventDefault();
  const fileId = e.dataTransfer.getData("text/plain");
  const refDoc = doc(db, "files", fileId);
  await updateDoc(refDoc, { folderId: targetFolderId });
  showToast("File dipindahkan!");
  e.target.classList.remove("drag-over");
}

// === Preview ===
window.previewFile = (url) => {
  const modal = document.getElementById("preview-modal");
  const body = document.getElementById("preview-body");
  const download = document.getElementById("preview-download");
  body.innerHTML = `<iframe src="${url}" width="100%" height="600"></iframe>`;
  download.href = url;
  modal.setAttribute("aria-hidden", "false");
};
document.getElementById("close-preview").onclick = () =>
  document.getElementById("preview-modal").setAttribute("aria-hidden", "true");

// === Search + Sort ===
globalSearch.addEventListener("input", () => {
  const term = globalSearch.value.toLowerCase();
  [...fileList.children].forEach((li) => {
    const name = li.querySelector(".file-name")?.textContent.toLowerCase() || "";
    li.style.display = name.includes(term) ? "" : "none";
  });
});

// === Theme Toggle ===
const themeBtn = document.getElementById("toggle-theme");
themeBtn.onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
};
document.documentElement.dataset.theme =
  localStorage.getItem("theme") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

// === Helper ===
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}

function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = "block";
  setTimeout(() => (toast.style.display = "none"), 2500);
}
