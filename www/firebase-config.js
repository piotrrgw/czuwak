import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================================
// 1. BAZA SYSTEMOWA (Status wersji / publikacje LOUD)
// ==========================================
const primaryConfig = {
  apiKey: "AIzaSyA2T7JJ42rWsgt1f585Zgb7Wq8bf2yBN2w",
  authDomain: "asystent-kas-biletowych.firebaseapp.com",
  projectId: "asystent-kas-biletowych",
  storageBucket: "asystent-kas-biletowych.firebasestorage.app",
  messagingSenderId: "916289197780",
  appId: "1:916289197780:web:bcb9d74faa53c1b0b48d41",
  measurementId: "G-2JHBE2GV2X"
};
const app = initializeApp(primaryConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ==========================================
// 2. BAZA POCIĄGÓW (trasy-ic)
// ==========================================
const trainsConfig = {
  apiKey: "AIzaSyDjlMaTs-DgqUMGME03OP9oOOZVY855dHU",
  authDomain: "trasy-ic.firebaseapp.com",
  projectId: "trasy-ic",
  storageBucket: "trasy-ic.firebasestorage.app",
  messagingSenderId: "783828921334",
  appId: "1:783828921334:web:f3203af8fbf9f4760575d7",
  measurementId: "G-EK78LFWDXQ"
};
const trainsApp = initializeApp(trainsConfig, 'trainsApp');
export const trainsDb = getFirestore(trainsApp);
export const trainsAuth = getAuth(trainsApp);

// ==========================================
// 3. BAZA DANYCH PUBLICZNYCH (akb-data)
// ==========================================
const publicConfig = {
  apiKey: "AIzaSyCFxopq44ISarrhnGIYNgmjndx6AQGeJRE",
  authDomain: "akb-data.firebaseapp.com",
  projectId: "akb-data",
  storageBucket: "akb-data.firebasestorage.app",
  messagingSenderId: "910682828809",
  appId: "1:910682828809:web:53f5c52ded28a810b948d8"
};
const publicApp = initializeApp(publicConfig, 'publicApp');
export const publicDb = getFirestore(publicApp);
export const publicAuth = getAuth(publicApp);
