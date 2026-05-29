// Firebase Configuration and Repository Interface

// Get configuration from localStorage
export function getSavedFirebaseConfig() {
  const config = localStorage.getItem('fighting_waste_firebase_config');
  if (config) {
    try {
      return JSON.parse(config);
    } catch (e) {
      console.error("Failed to parse saved Firebase config", e);
    }
  }
  return null;
}

export function saveFirebaseConfig(config) {
  if (!config) {
    localStorage.removeItem('fighting_waste_firebase_config');
  } else {
    localStorage.setItem('fighting_waste_firebase_config', JSON.stringify(config));
  }
}

// Database Repository interface with Firebase and LocalStorage Fallback
class DatabaseService {
  constructor() {
    this.isLiveFirebase = false;
    this.db = null;
    this.storage = null;
    this.listeners = [];
  }

  async initialize() {
    const config = getSavedFirebaseConfig();
    if (!config || !config.apiKey) {
      console.warn("No Firebase configuration found. Running in LocalStorage Demo Mode.");
      this.isLiveFirebase = false;
      return false;
    }

    try {
      // Dynamically import Firebase libraries
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
      const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
      const { getStorage } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js");

      const app = initializeApp(config);
      this.db = getFirestore(app);
      this.storage = getStorage(app);
      this.isLiveFirebase = true;
      console.log("Firebase initialized successfully! Live Mode enabled.");
      return true;
    } catch (error) {
      console.error("Firebase initialization failed, falling back to LocalStorage Mode.", error);
      this.isLiveFirebase = false;
      return false;
    }
  }

  // --- CRUD API ---

  async getItems() {
    if (this.isLiveFirebase) {
      try {
        const { collection, getDocs, query, orderBy } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const q = query(collection(this.db, "food_items"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        const items = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        return items;
      } catch (e) {
        console.error("Firestore getItems failed, using LocalStorage backup", e);
      }
    }

    // LocalStorage Fallback
    const localItems = localStorage.getItem('fighting_waste_items');
    return localItems ? JSON.parse(localItems) : getMockInitialData();
  }

  async addItem(item) {
    const itemData = {
      ...item,
      createdAt: new Date().toISOString(),
      status: item.status || "available" // available, claimed, disposed
    };

    if (this.isLiveFirebase) {
      try {
        const { collection, addDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const docRef = await addDoc(collection(this.db, "food_items"), itemData);
        return { id: docRef.id, ...itemData };
      } catch (e) {
        console.error("Firestore addItem failed", e);
      }
    }

    // LocalStorage Fallback
    const items = await this.getItems();
    const newId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const newItem = { id: newId, ...itemData };
    items.unshift(newItem);
    localStorage.setItem('fighting_waste_items', JSON.stringify(items));
    this.triggerListeners();
    return newItem;
  }

  async updateItem(id, updatedFields) {
    if (this.isLiveFirebase && !id.startsWith('local_')) {
      try {
        const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const docRef = doc(this.db, "food_items", id);
        await updateDoc(docRef, updatedFields);
        return true;
      } catch (e) {
        console.error("Firestore updateItem failed", e);
      }
    }

    // LocalStorage Fallback
    const items = await this.getItems();
    const index = items.findIndex(item => item.id === id);
    if (index !== -1) {
      items[index] = { ...items[index], ...updatedFields };
      localStorage.setItem('fighting_waste_items', JSON.stringify(items));
      this.triggerListeners();
      return true;
    }
    return false;
  }

  async deleteItem(id) {
    if (this.isLiveFirebase && !id.startsWith('local_')) {
      try {
        const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const docRef = doc(this.db, "food_items", id);
        await deleteDoc(docRef);
        return true;
      } catch (e) {
        console.error("Firestore deleteItem failed", e);
      }
    }

    // LocalStorage Fallback
    const items = await this.getItems();
    const filtered = items.filter(item => item.id !== id);
    localStorage.setItem('fighting_waste_items', JSON.stringify(filtered));
    this.triggerListeners();
    return true;
  }

  async uploadImage(fileOrBase64, filename) {
    if (this.isLiveFirebase && this.storage) {
      try {
        const { ref, uploadString, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js");
        const storageRef = ref(this.storage, `food_images/${Date.now()}_${filename}`);
        
        // If it is a base64 string
        if (typeof fileOrBase64 === 'string' && fileOrBase64.startsWith('data:image')) {
          await uploadString(storageRef, fileOrBase64, 'data_url');
          return await getDownloadURL(storageRef);
        }
      } catch (e) {
        console.error("Firebase Storage image upload failed, falling back to Base64 storage", e);
      }
    }

    // LocalStorage/Base64 Fallback (stores base64 directly as URL)
    return fileOrBase64;
  }

  // Live updates notification listener
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(c => c !== callback);
    };
  }

  triggerListeners() {
    this.listeners.forEach(callback => callback());
  }
}

// Initial Mock data for premium demo look-and-feel
function getMockInitialData() {
  const baseData = [
    {
      id: "mock_1",
      name: "御飯糰-肉鬆口味",
      category: "expiring",
      mfgDate: "2026-05-29",
      expDate: "2026-05-30",
      freshness: 94,
      status: "available",
      notes: "包裝完整，超商18小時鮮食，存放於冷藏櫃。",
      imageUrl: "https://images.unsplash.com/photo-1618040981136-1e6cfa3f20d1?auto=format&fit=crop&q=80&w=400",
      createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString() // 30 mins ago
    },
    {
      id: "mock_2",
      name: "香烤雞腿排便當",
      category: "bento",
      mfgDate: "2026-05-30",
      expDate: "2026-05-30",
      freshness: 85,
      status: "available",
      notes: "第一餐廳自助餐未售完便當，附完整餐盒，請儘速食用。",
      imageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=400",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() // 2 hours ago
    },
    {
      id: "mock_3",
      name: "活動多餘餐盒 (排骨便當)",
      category: "event",
      mfgDate: "2026-05-30",
      expDate: "2026-05-30",
      freshness: 90,
      status: "available",
      notes: "工學院研討會剩餘未開封便當，附免洗筷，已放置於工學一館1樓大廳。",
      imageUrl: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&q=80&w=400",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString() // 3 hours ago
    },
    {
      id: "mock_4",
      name: "學二餐廳生鮮有機廚餘",
      category: "waste",
      mfgDate: "2026-05-29",
      expDate: "2026-05-31",
      freshness: 45,
      status: "available",
      notes: "蔬菜邊角料與果皮，可用作堆肥，已分類裝桶，重約12kg。",
      imageUrl: "https://images.unsplash.com/photo-1606787366850-de6330128bfc?auto=format&fit=crop&q=80&w=400",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() // 5 hours ago
    }
  ];
  
  localStorage.setItem('fighting_waste_items', JSON.stringify(baseData));
  return baseData;
}

export const dbService = new DatabaseService();
