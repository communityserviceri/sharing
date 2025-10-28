import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { 
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { 
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

// ✅ Firebase Atlantis Store Config
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

// DOM elements
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const loginSection = document.getElementById("login-section");
const appSection = document.getElementById("app-section");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");

const folderForm = document.getElementById("folder-form");
const folderNameInput = document.getElementById("folder-name");
const folderList = document.getElementById("folder-list");
const fileList = document.getElementById("file-list");
const uploadBtn = document.getElementById("upload-btn");
const fileInput = document.getElementById("file-input");
const folderTitle = document.getElementById("folder-title");

let currentUser = null;
let currentFolder = null;

// 🔐 LOGIN ADMIN
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  try {
    const userCred = await signInWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
    console.log("Login success:", userCred.user.email);
  } catch (err) {
    loginError.textContent = "Login gagal: " + err.message;
  }
});

// 🚪 LOGOUT
logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

// 👀 AUTH STATE
onAuthStateChanged(auth, (user) => {
  if (user && user.email === "admin@atlantis.com") {
    currentUser = user;
    loginSection.style.display = "none";
    appSection.style.display = "block";
    userInfo.textContent = `Login sebagai: ${user.email}`;
    loadFolders();
  } else {
    loginSection.style.display = "block";
    appSection.style.display = "none";
    currentUser = null;
  }
});

// 📁 FOLDER CRUD
function loadFolders() {
  const q = query(collection(db, "folders"), orderBy("createdAt", "desc"));
  onSnapshot(q, snapshot => {
    folderList.innerHTML = "";
    snapshot.forEach(docSnap => {
      const f = docSnap.data();
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${f.name}</span>
        <div>
          <button onclick="renameFolder('${docSnap.id}', '${f.name}')">✏️</button>
          <button onclick="deleteFolder('${docSnap.id}')">🗑️</button>
        </div>
      `;
      li.addEventListener("click", () => selectFolder(docSnap.id, f.name));
      folderList.appendChild(li);
    });
  });
}

folderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = folderNameInput.value.trim();
  if (!name) return;
  await addDoc(collection(db, "folders"), {
    name,
    createdAt: serverTimestamp(),
    createdBy: currentUser.email
  });
  folderNameInput.value = "";
});

// 🗂 FILE CRUD
async function selectFolder(folderId, name) {
  currentFolder = folderId;
  folderTitle.textContent = "📁 " + name;
  uploadBtn.disabled = false;
  loadFiles(folderId);
}

function loadFiles(folderId) {
  const q = query(collection(db, "files"), where("folderId", "==", folderId), orderBy("createdAt", "desc"));
  onSnapshot(q, snapshot => {
    fileList.innerHTML = "";
    snapshot.forEach(docSnap => {
      const f = docSnap.data();
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${f.name}</span>
        <div>
          <a href="${f.downloadURL}" target="_blank">🔗</a>
          <button onclick="renameFile('${docSnap.id}', '${f.name}')">✏️</button>
          <button onclick="deleteFile('${docSnap.id}', '${f.storagePath}')">🗑️</button>
        </div>
      `;
      fileList.appendChild(li);
    });
  });
}

uploadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentFolder) return;
  const path = `uploads/${currentFolder}/${Date.now()}-${file.name}`;
  const ref = storageRef(storage, path);
  const uploadTask = uploadBytesResumable(ref, file);
  uploadTask.on("state_changed", null, console.error, async () => {
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
    fileInput.value = "";
  });
});

window.deleteFile = async (id, path) => {
  await deleteObject(storageRef(storage, path));
  await deleteDoc(doc(db, "files", id));
};

window.renameFile = async (id, oldName) => {
  const newName = prompt("Ubah nama file:", oldName);
  if (!newName) return;
  await updateDoc(doc(db, "files", id), { name: newName });
};

window.deleteFolder = async (id) => {
  if (!confirm("Hapus folder dan semua file di dalamnya?")) return;
  const q = query(collection(db, "files"), where("folderId", "==", id));
  const snap = await getDocs(q);
  for (const docSnap of snap.docs) {
    const f = docSnap.data();
    await deleteObject(storageRef(storage, f.storagePath));
    await deleteDoc(doc(db, "files", docSnap.id));
  }
  await deleteDoc(doc(db, "folders", id));
};

window.renameFolder = async (id, oldName) => {
  const newName = prompt("Ubah nama folder:", oldName);
  if (!newName) return;
  await updateDoc(doc(db, "folders", id), { name: newName });
};
