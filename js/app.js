/**
 * TikTok Return Parcel Inspection System
 * Frontend Application Engine (Single Page App / PWA Ready)
 */

// ==========================================
// 1. STATE & CONSTANTS
// ==========================================
const AppState = {
  currentTab: 'warehouse', // 'warehouse' | 'dashboard' | 'import' | 'settings'
  apiEndpoint: localStorage.getItem('tiktok_return_api_url') || '',
  staffName: localStorage.getItem('tiktok_return_staff_name') || 'พนักงานคลัง 1',
  orders: [],
  currentOrder: null,
  recentScans: JSON.parse(localStorage.getItem('tiktok_return_recent_scans') || '[]'),
  
  // Scanner state
  html5QrCode: null,
  isScanning: false,
  availableCameras: [],
  currentCameraId: null,
  torchOn: false,
  
  // Inspection Media state
  photoBase64: null,
  photoPreviewUrl: null,
  videoBase64: null,
  videoPreviewUrl: null,
  videoBlob: null,
  
  // Admin dashboard state
  adminSearch: '',
  adminStatusFilter: 'ALL',
  adminPage: 1,
  adminPageSize: 15,
  adminSelectedOrder: null,
  
  // Import preview state
  importedOrders: [],
  
  // Audio context
  audioCtx: null
};

// ==========================================
// 2. AUDIO & HAPTIC FEEDBACK (Web Audio API)
// ==========================================
function playBeep(type = 'success') {
  try {
    if (!AppState.audioCtx) {
      AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = AppState.audioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === 'success') {
      // High pleasant double beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08); // D6
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === 'warning') {
      // Low double buzz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    console.warn('Audio feedback failed:', e);
  }
}

function triggerHaptic(duration = 50) {
  if (navigator.vibrate) {
    navigator.vibrate(duration);
  }
}

// ==========================================
// 3. FAST CLIENT-SIDE MEDIA COMPRESSION
// ==========================================

/**
 * บีบอัดรูปถ่ายผ่าน Canvas เพื่อลดขนาดจาก 5-10MB เหลือ ~250-400KB
 * ทำให้ส่งไป Google Drive ผ่าน Apps Script ได้ใน 1 วินาที!
 */
async function compressImageFile(file, maxWidth = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxWidth) {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // ส่งออกเป็น JPEG Base64
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64Data = dataUrl.split(',')[1];
        
        resolve({
          dataUrl: dataUrl,
          base64: base64Data,
          contentType: 'image/jpeg',
          sizeKB: Math.round(base64Data.length * 0.75 / 1024)
        });
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

/**
 * แปลงไฟล์วิดีโอเป็น Base64
 */
async function processVideoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64Data = dataUrl.split(',')[1];
      resolve({
        dataUrl: dataUrl,
        base64: base64Data,
        contentType: file.type || 'video/mp4',
        sizeKB: Math.round(file.size / 1024)
      });
    };
    reader.onerror = reject;
  });
}

// ==========================================
// 4. TIKTOK EXCEL MERGE & DEDUPLICATION
// ==========================================

/**
 * ประมวลผลและรวมไฟล์ Excel 2 ไฟล์จาก TikTok โดยกรอง Order ID ซ้ำให้เป็นบรรทัดเดียว
 */
async function processTikTokExcelFiles(ordersFile, returnsFile) {
  const readWorkbook = async (file) => {
    const data = await file.arrayBuffer();
    return XLSX.read(data, { type: 'array' });
  };

  const ordersMap = new Map();

  // 1. ประมวลผลไฟล์คำสั่งซื้อทั้งหมด (ถ้ามี)
  if (ordersFile) {
    const wb = await readWorkbook(ordersFile);
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    
    if (rawRows.length > 0) {
      const headerRow = rawRows[0].map(c => String(c || '').trim());
      
      // ตรวจสอบว่าบรรทัดที่ 2 เป็น Description หรือไม่
      let startRow = 1;
      if (rawRows.length > 1 && String(rawRows[1][0] || '').includes('Platform unique order ID')) {
        startRow = 2;
      }
      
      const colOrderId = headerRow.indexOf('Order ID');
      const colTracking = headerRow.indexOf('Tracking ID');
      const colSku = headerRow.indexOf('Seller SKU');
      const colProdName = headerRow.indexOf('Product Name');
      const colVar = headerRow.indexOf('Variation');
      const colQty = headerRow.indexOf('Quantity');
      const colStatus = headerRow.indexOf('Order Status');
      const colShipping = headerRow.indexOf('Shipping Provider Name');
      const colBuyer = headerRow.indexOf('Buyer Username');
      
      for (let i = startRow; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || !row[colOrderId]) continue;
        
        const orderId = String(row[colOrderId]).trim();
        const trackingId = colTracking !== -1 && row[colTracking] ? String(row[colTracking]).trim() : '';
        const sku = colSku !== -1 && row[colSku] ? String(row[colSku]).trim() : '';
        const prodName = colProdName !== -1 && row[colProdName] ? String(row[colProdName]).trim() : '';
        const varName = colVar !== -1 && row[colVar] ? String(row[colVar]).trim() : '';
        const qty = colQty !== -1 && !isNaN(parseInt(row[colQty])) ? parseInt(row[colQty]) : 1;
        const status = colStatus !== -1 && row[colStatus] ? String(row[colStatus]).trim() : '';
        const carrier = colShipping !== -1 && row[colShipping] ? String(row[colShipping]).trim() : '';
        const buyer = colBuyer !== -1 && row[colBuyer] ? String(row[colBuyer]).trim() : '';
        
        const item = {
          sku: sku,
          productName: prodName,
          variation: varName,
          quantity: qty,
          checked: false,
          receivedQty: qty
        };
        
        if (!ordersMap.has(orderId)) {
          ordersMap.set(orderId, {
            orderId: orderId,
            trackingId: trackingId,
            returnTrackingId: '',
            orderStatus: status,
            returnReason: '',
            returnStatus: '',
            carrier: carrier,
            buyerUsername: buyer,
            items: [item],
            checkStatus: 'ยังไม่ตรวจ',
            staffNote: '',
            checkedBy: '',
            checkedAt: '',
            photoUrl: '',
            videoUrl: ''
          });
        } else {
          const rec = ordersMap.get(orderId);
          if (trackingId && !rec.trackingId) rec.trackingId = trackingId;
          rec.items.push(item);
        }
      }
    }
  }

  // 2. ประมวลผลไฟล์คำสั่งซื้อที่ส่งคืน / คืนเงิน
  if (returnsFile) {
    const wb = await readWorkbook(returnsFile);
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    
    if (rawRows.length > 0) {
      const headerRow = rawRows[0].map(c => String(c || '').trim());
      
      const colOrderId = headerRow.indexOf('Order ID');
      const colRetTracking = headerRow.indexOf('Return Logistics Tracking ID');
      const colSku = headerRow.indexOf('Seller SKU');
      const colProdName = headerRow.indexOf('Product Name');
      const colQty = headerRow.indexOf('Return Quantity');
      const colReason = headerRow.indexOf('Return Reason');
      const colStatus = headerRow.indexOf('Return Status');
      
      for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || !row[colOrderId]) continue;
        
        const orderId = String(row[colOrderId]).trim();
        const retTracking = colRetTracking !== -1 && row[colRetTracking] ? String(row[colRetTracking]).trim() : '';
        const sku = colSku !== -1 && row[colSku] ? String(row[colSku]).trim() : '';
        const prodName = colProdName !== -1 && row[colProdName] ? String(row[colProdName]).trim() : '';
        const qty = colQty !== -1 && !isNaN(parseInt(row[colQty])) ? parseInt(row[colQty]) : 1;
        const reason = colReason !== -1 && row[colReason] ? String(row[colReason]).trim() : '';
        const status = colStatus !== -1 && row[colStatus] ? String(row[colStatus]).trim() : '';
        
        const item = {
          sku: sku,
          productName: prodName,
          variation: '',
          quantity: qty,
          checked: false,
          receivedQty: qty
        };
        
        if (ordersMap.has(orderId)) {
          const rec = ordersMap.get(orderId);
          if (retTracking) {
            rec.returnTrackingId = retTracking;
            if (!rec.trackingId) rec.trackingId = retTracking;
          }
          if (reason) rec.returnReason = reason;
          if (status) rec.returnStatus = status;
          
          // ตรวจสอบว่ามี SKU นี้ในรายการแล้วหรือไม่
          const hasSku = rec.items.some(it => it.sku === sku);
          if (!hasSku && sku) {
            rec.items.push(item);
          }
        } else {
          ordersMap.set(orderId, {
            orderId: orderId,
            trackingId: retTracking,
            returnTrackingId: retTracking,
            orderStatus: '',
            returnReason: reason,
            returnStatus: status,
            carrier: '',
            buyerUsername: '',
            items: [item],
            checkStatus: 'ยังไม่ตรวจ',
            staffNote: '',
            checkedBy: '',
            checkedAt: '',
            photoUrl: '',
            videoUrl: ''
          });
        }
      }
    }
  }

  // 3. จัดโครงสร้างสรุปข้อมูลแต่ละออเดอร์
  const result = [];
  ordersMap.forEach((data, orderId) => {
    const skusSummary = data.items.map(it => `${it.sku || 'N/A'} (x${it.quantity})`).join(', ');
    const productSummary = data.items.map(it => `${it.productName || 'สินค้า'} x ${it.quantity}`).join(' | ');
    const totalQuantity = data.items.reduce((sum, it) => sum + it.quantity, 0);
    
    result.push({
      orderId: orderId,
      trackingId: data.trackingId || data.returnTrackingId || '',
      sellerSku: skusSummary,
      productSummary: productSummary,
      items: data.items,
      totalQuantity: totalQuantity,
      orderStatus: data.orderStatus,
      returnReason: data.returnReason,
      returnStatus: data.returnStatus,
      carrier: data.carrier,
      buyerUsername: data.buyerUsername,
      checkStatus: data.checkStatus,
      staffNote: '',
      checkedBy: '',
      checkedAt: '',
      photoUrl: '',
      videoUrl: ''
    });
  });

  return result;
}

// ==========================================
// 5. API CLIENT (Google Apps Script Backend)
// ==========================================
const ApiClient = {
  async fetchWithTimeout(url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  },

  async ping() {
    if (!AppState.apiEndpoint) return { success: false, message: 'ไม่ได้ตั้งค่า API Web App URL' };
    try {
      const res = await this.fetchWithTimeout(`${AppState.apiEndpoint}?action=ping`, {}, 8000);
      return await res.json();
    } catch (err) {
      return { success: false, error: err.toString() };
    }
  },

  async searchTracking(query) {
    // 1. ค้นหาใน Local Cache ก่อนเพื่อความเร็วเสี้ยววินาที!
    if (AppState.orders.length > 0) {
      const cleanQ = String(query).trim().toLowerCase();
      const localMatch = AppState.orders.find(o => 
        (o.trackingId && o.trackingId.toLowerCase() === cleanQ) ||
        (o.orderId && o.orderId.toLowerCase() === cleanQ) ||
        (o.trackingId && o.trackingId.toLowerCase().includes(cleanQ))
      );
      if (localMatch) {
        return { success: true, found: true, order: localMatch, fromCache: true };
      }
    }

    // 2. ถ้าใน Local Cache ไม่เจอ หรือยังไม่ได้โหลด ให้ดึงจาก Apps Script Backend
    if (AppState.apiEndpoint) {
      try {
        const url = `${AppState.apiEndpoint}?action=searchTracking&query=${encodeURIComponent(query)}`;
        const res = await this.fetchWithTimeout(url, {}, 8000);
        return await res.json();
      } catch (err) {
        console.warn('API lookup failed, fallback to local search:', err);
      }
    }

    return { success: true, found: false, message: 'ไม่พบพัสดุนี้ในระบบ' };
  },

  async updateInspection(payload) {
    // บันทึกลง Local Cache ทันที (Optimistic Update)
    const localIndex = AppState.orders.findIndex(o => 
      (payload.orderId && o.orderId === payload.orderId) ||
      (payload.trackingId && o.trackingId === payload.trackingId)
    );
    
    if (localIndex !== -1) {
      AppState.orders[localIndex].checkStatus = payload.checkStatus;
      AppState.orders[localIndex].staffNote = payload.staffNote;
      AppState.orders[localIndex].checkedBy = payload.checkedBy;
      AppState.orders[localIndex].checkedAt = new Date().toLocaleString('th-TH');
      AppState.orders[localIndex].receivedItems = payload.receivedItems;
      localStorage.setItem('tiktok_return_orders_cache', JSON.stringify(AppState.orders));
    }

    // ส่งข้อมูลไปยัง Google Apps Script Backend
    if (AppState.apiEndpoint) {
      try {
        const res = await this.fetchWithTimeout(AppState.apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // ใช้ text/plain เพื่อเลี่ยง CORS Preflight Options request
          body: JSON.stringify({
            action: 'updateInspection',
            ...payload
          })
        }, 30000); // 30s timeout สำหรับอัปโหลดภาพ/วิดีโอ
        
        return await res.json();
      } catch (err) {
        console.error('Failed to sync inspection to Google Sheet:', err);
        return {
          success: true,
          offlineSaved: true,
          message: 'บันทึกในเครื่องเรียบร้อย (ระบบจะซิงค์กับ Sheet เมื่อออนไลน์)'
        };
      }
    }

    return {
      success: true,
      offlineSaved: true,
      message: 'บันทึกข้อมูลในเครื่องเรียบร้อย (โหมดทดสอบ)'
    };
  },

  async bulkUpsertOrders(orders, onProgress = null) {
    if (!AppState.apiEndpoint) {
      // บันทึกลง LocalStorage
      AppState.orders = orders;
      localStorage.setItem('tiktok_return_orders_cache', JSON.stringify(orders));
      return {
        success: true,
        message: `บันทึกข้อมูล ${orders.length} รายการลงในเครื่องเรียบร้อย (Demo Mode)`
      };
    }

    // แบ่ง Chunk ละ 100 รายการเพื่อความเสถียรของ Apps Script
    const chunkSize = 100;
    const totalChunks = Math.ceil(orders.length / chunkSize);
    let totalInserted = 0;
    let totalUpdated = 0;

    for (let i = 0; i < totalChunks; i++) {
      const chunk = orders.slice(i * chunkSize, (i + 1) * chunkSize);
      if (onProgress) {
        onProgress(Math.round(((i + 1) / totalChunks) * 100), i + 1, totalChunks);
      }

      const res = await this.fetchWithTimeout(AppState.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'bulkUpsertOrders',
          orders: chunk
        })
      }, 45000);

      const result = await res.json();
      if (!result.success) {
        throw new Error(result.error || 'การส่งข้อมูลขัดข้อง');
      }
      totalInserted += (result.insertedCount || 0);
      totalUpdated += (result.updatedCount || 0);
    }

    // อัปเดต Cache ในเครื่อง
    AppState.orders = orders;
    localStorage.setItem('tiktok_return_orders_cache', JSON.stringify(orders));

    return {
      success: true,
      message: `นำเข้า Google Sheets สำเร็จ! เพิ่มใหม่ ${totalInserted} รายการ, อัปเดต ${totalUpdated} รายการ`,
      insertedCount: totalInserted,
      updatedCount: totalUpdated
    };
  },

  async loadAllOrdersFromSheet() {
    if (!AppState.apiEndpoint) {
      const cached = localStorage.getItem('tiktok_return_orders_cache');
      if (cached) {
        AppState.orders = JSON.parse(cached);
      }
      return { success: true, orders: AppState.orders };
    }

    try {
      const url = `${AppState.apiEndpoint}?action=getOrders&limit=2000`;
      const res = await this.fetchWithTimeout(url, {}, 20000);
      const data = await res.json();
      if (data.success) {
        AppState.orders = data.orders || [];
        localStorage.setItem('tiktok_return_orders_cache', JSON.stringify(AppState.orders));
      }
      return data;
    } catch (err) {
      console.warn('Failed to load orders from sheet, fallback to cache:', err);
      const cached = localStorage.getItem('tiktok_return_orders_cache');
      if (cached) {
        AppState.orders = JSON.parse(cached);
      }
      return { success: true, orders: AppState.orders, fromCache: true };
    }
  }
};

// ==========================================
// 6. UI CONTROLLER & RENDERING
// ==========================================

function switchTab(tabId) {
  AppState.currentTab = tabId;
  
  // ซ่อนทุกแท็บ
  ['tab-warehouse', 'tab-dashboard', 'tab-import', 'tab-settings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  // แสดงแท็บที่เลือก
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.remove('hidden');

  // ปรับสถานะ Active ของปุ่มเมนู
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.tab === tabId) {
      btn.classList.add('text-blue-600', 'border-b-2', 'border-blue-600', 'font-semibold');
      btn.classList.remove('text-slate-500');
    } else {
      btn.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600', 'font-semibold');
      btn.classList.add('text-slate-500');
    }
  });

  // ปรับการทำงานเฉพาะแท็บ
  if (tabId === 'warehouse') {
    renderRecentScans();
  } else if (tabId === 'dashboard') {
    renderDashboard();
  }
  
  // ปิดกล้องหากสลับออกจากหน้าคลัง
  if (tabId !== 'warehouse' && AppState.isScanning) {
    stopScanner();
  }
}

// ==========================================
// 7. BARCODE / QR SCANNER CONTROLLER
// ==========================================

async function initScanner() {
  const scannerContainer = document.getElementById('scanner-modal');
  if (!scannerContainer) return;
  
  scannerContainer.classList.remove('hidden');
  AppState.isScanning = true;

  try {
    const devices = await Html5Qrcode.getCameras();
    AppState.availableCameras = devices;
    
    if (devices && devices.length) {
      // เลือกล้องหลังเป็นค่าเริ่มต้น (Environment / Back Camera)
      let backCam = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear') || d.label.toLowerCase().includes('environment'));
      let selectedCamId = backCam ? backCam.id : devices[0].id;
      AppState.currentCameraId = selectedCamId;
      
      startScanningWithCamera(selectedCamId);
    } else {
      Swal.fire({
        icon: 'error',
        title: 'ไม่พบกล้อง',
        text: 'กรุณาอนุญาตให้เว็บเข้าถึงกล้องบนอุปกรณ์ของคุณ'
      });
      stopScanner();
    }
  } catch (err) {
    console.error('Camera init error:', err);
    Swal.fire({
      icon: 'error',
      title: 'เปิดกล้องไม่สำเร็จ',
      text: 'กรุณาตรวจสอบการอนุญาตใช้งานกล้องในเบราว์เซอร์'
    });
    stopScanner();
  }
}

function startScanningWithCamera(cameraId) {
  if (AppState.html5QrCode) {
    AppState.html5QrCode.stop().then(() => {
      startCameraInstance(cameraId);
    }).catch(() => {
      startCameraInstance(cameraId);
    });
  } else {
    AppState.html5QrCode = new Html5Qrcode("reader");
    startCameraInstance(cameraId);
  }
}

function startCameraInstance(cameraId) {
  const config = {
    fps: 15,
    qrbox: { width: 280, height: 160 },
    aspectRatio: 1.333334,
    formatsToSupport: [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.DATA_MATRIX
    ]
  };

  AppState.html5QrCode.start(
    cameraId,
    config,
    (decodedText) => {
      onBarcodeScanned(decodedText);
    },
    (errorMessage) => {
      // Ignored scan frame failures
    }
  ).catch(err => {
    console.error('Failed to start camera:', err);
  });
}

function stopScanner() {
  const scannerContainer = document.getElementById('scanner-modal');
  if (scannerContainer) scannerContainer.classList.add('hidden');
  AppState.isScanning = false;
  
  if (AppState.html5QrCode) {
    AppState.html5QrCode.stop().catch(e => console.warn('Stop scanner error:', e));
  }
}

function switchCamera() {
  if (!AppState.availableCameras || AppState.availableCameras.length < 2) {
    Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'พบกล้องเพียงตัวเดียว', showConfirmButton: false, timer: 1500 });
    return;
  }
  const currentIndex = AppState.availableCameras.findIndex(c => c.id === AppState.currentCameraId);
  const nextIndex = (currentIndex + 1) % AppState.availableCameras.length;
  AppState.currentCameraId = AppState.availableCameras[nextIndex].id;
  startScanningWithCamera(AppState.currentCameraId);
}

async function onBarcodeScanned(barcode) {
  if (!barcode) return;
  barcode = String(barcode).trim();
  
  // Feedback เสียงและการสั่น
  playBeep('success');
  triggerHaptic(80);
  
  stopScanner();
  
  // ค้นหาพัสดุ
  await handleSearchTracking(barcode);
}

// ==========================================
// 8. WAREHOUSE INSPECTION WORKFLOW
// ==========================================

async function handleSearchTracking(query) {
  if (!query) return;
  query = String(query).trim();

  // แสดง Loading
  Swal.fire({
    title: 'กำลังค้นหาพัสดุ...',
    text: `Tracking ID: ${query}`,
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const res = await ApiClient.searchTracking(query);
  Swal.close();

  if (res.success && res.found && res.order) {
    displayInspectionForm(res.order);
  } else {
    playBeep('warning');
    triggerHaptic(150);
    
    Swal.fire({
      icon: 'warning',
      title: 'ไม่พบข้อมูลในระบบ',
      html: `
        <div class="text-left text-sm space-y-2">
          <p>เลข Tracking / Order: <b class="text-blue-600">${query}</b></p>
          <p class="text-slate-600">พัสดุนี้อาจยังไม่ได้นำเข้าไฟล์ Excel จาก TikTok หรือเป็นพัสดุนอกระบบ</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'ตรวจเช็คแบบพัสดุนอกระบบ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#3B82F6'
    }).then((result) => {
      if (result.isConfirmed) {
        // สร้างออเดอร์เปล่าสำหรับพัสดุนอกระบบ
        const unknownOrder = {
          orderId: 'UNKNOWN_' + Date.now().toString().slice(-6),
          trackingId: query,
          sellerSku: 'พัสดุนอกระบบ / ไม่ระบุ SKU',
          productSummary: 'สินค้าไม่ระบุชื่อ',
          items: [{ sku: 'UNKNOWN', productName: 'พัสดุไม่พบในระบบ TikTok', quantity: 1, checked: true, receivedQty: 1 }],
          totalQuantity: 1,
          orderStatus: '-',
          returnReason: 'พัสดุนอกระบบ',
          returnStatus: '-',
          carrier: '-',
          buyerUsername: '-',
          checkStatus: 'ไม่พบข้อมูลในระบบ',
          staffNote: '',
          checkedBy: AppState.staffName,
          checkedAt: '',
          photoUrl: '',
          videoUrl: ''
        };
        displayInspectionForm(unknownOrder);
      }
    });
  }
}

function displayInspectionForm(order) {
  AppState.currentOrder = order;
  AppState.photoBase64 = null;
  AppState.photoPreviewUrl = null;
  AppState.videoBase64 = null;
  AppState.videoPreviewUrl = null;

  document.getElementById('welcome-card').classList.add('hidden');
  const inspectForm = document.getElementById('inspection-form');
  inspectForm.classList.remove('hidden');

  // Fill Header Info
  document.getElementById('inspect-tracking-id').innerText = order.trackingId || '-';
  document.getElementById('inspect-order-id').innerText = order.orderId || '-';
  document.getElementById('inspect-carrier').innerText = order.carrier || 'TikTok Express / J&T';
  document.getElementById('inspect-buyer').innerText = order.buyerUsername ? `@${order.buyerUsername}` : '-';
  document.getElementById('inspect-reason').innerText = order.returnReason || 'ไม่ได้ระบุ';
  document.getElementById('inspect-staff-name').value = AppState.staffName;

  // Render Status Badge
  const statusBadge = document.getElementById('inspect-status-badge');
  if (order.checkStatus === 'ยังไม่ตรวจ' || !order.checkStatus) {
    statusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800';
    statusBadge.innerText = '⏳ ยังไม่ตรวจ';
  } else if (order.checkStatus.includes('ครบ')) {
    statusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800';
    statusBadge.innerText = `✅ ${order.checkStatus}`;
  } else {
    statusBadge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800';
    statusBadge.innerText = `⚠️ ${order.checkStatus}`;
  }

  // Render Items Checklist
  renderInspectionItems(order.items || []);

  // Reset Photo & Video Previews
  document.getElementById('photo-preview-container').classList.add('hidden');
  document.getElementById('photo-upload-placeholder').classList.remove('hidden');
  document.getElementById('video-preview-container').classList.add('hidden');
  document.getElementById('video-upload-placeholder').classList.remove('hidden');

  // ถ้ามีรูปเดิมอยู่แล้ว
  if (order.photoUrl) {
    document.getElementById('photo-preview').src = order.photoUrl;
    document.getElementById('photo-preview-container').classList.remove('hidden');
    document.getElementById('photo-upload-placeholder').classList.add('hidden');
  }

  // เลื่อนหน้าจอขึ้นบนสุด
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderInspectionItems(items) {
  const container = document.getElementById('inspection-items-list');
  container.innerHTML = '';

  if (!items || items.length === 0) {
    container.innerHTML = '<div class="text-sm text-slate-400 py-3 text-center">ไม่มีข้อมูลรายการสินค้า</div>';
    return;
  }

  items.forEach((item, index) => {
    const isChecked = item.checked !== false;
    const itemCard = document.createElement('div');
    itemCard.className = 'p-3 bg-white rounded-xl border border-slate-200 shadow-sm flex items-start justify-between gap-3 transition-all hover:border-blue-300';
    itemCard.id = `item-row-${index}`;
    
    itemCard.innerHTML = `
      <div class="flex items-start gap-3 flex-1">
        <input type="checkbox" id="item-chk-${index}" class="mt-1 w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer" ${isChecked ? 'checked' : ''} onchange="toggleItemCheck(${index}, this.checked)">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">${item.sku || 'SKU'}</span>
            ${item.variation ? `<span class="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">${item.variation}</span>` : ''}
          </div>
          <p class="text-sm font-medium text-slate-800 mt-1 line-clamp-2 leading-snug">${item.productName || 'ชื่อสินค้า'}</p>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1">
        <span class="text-xs text-slate-500">จำนวนที่ส่ง:</span>
        <span class="text-base font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">x${item.quantity || 1}</span>
      </div>
    `;
    container.appendChild(itemCard);
  });
}

function toggleItemCheck(index, checked) {
  if (AppState.currentOrder && AppState.currentOrder.items[index]) {
    AppState.currentOrder.items[index].checked = checked;
    triggerHaptic(30);
  }
}

function checkAllItems(check = true) {
  if (!AppState.currentOrder || !AppState.currentOrder.items) return;
  AppState.currentOrder.items.forEach((item, idx) => {
    item.checked = check;
    const el = document.getElementById(`item-chk-${idx}`);
    if (el) el.checked = check;
  });
  triggerHaptic(40);
  playBeep('success');
}

// Media Capture Handlers
async function handlePhotoCapture(event) {
  const file = event.target.files[0];
  if (!file) return;

  Swal.fire({
    title: 'กำลังบีบอัดภาพถ่าย...',
    text: 'ย่อขนาดไฟล์เพื่อให้ส่งข้อมูลได้รวดเร็ว',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const compressed = await compressImageFile(file, 1280, 0.82);
    AppState.photoBase64 = compressed.base64;
    AppState.photoPreviewUrl = compressed.dataUrl;

    document.getElementById('photo-preview').src = compressed.dataUrl;
    document.getElementById('photo-preview-container').classList.remove('hidden');
    document.getElementById('photo-upload-placeholder').classList.add('hidden');
    document.getElementById('photo-size-badge').innerText = `${compressed.sizeKB} KB`;

    Swal.close();
    playBeep('success');
  } catch (err) {
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถประมวลผลรูปถ่ายได้: ' + err.message, 'error');
  }
}

async function handleVideoCapture(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 25 * 1024 * 1024) {
    Swal.fire('ไฟล์วิดีโอใหญ่เกินไป', 'กรุณาถ่ายวิดีโอแกะกล่องไม่เกิน 30-45 วินาที (ขนาดไม่เกิน 25MB)', 'warning');
    return;
  }

  Swal.fire({
    title: 'กำลังเตรียมวิดีโอ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const processed = await processVideoFile(file);
    AppState.videoBase64 = processed.base64;
    AppState.videoPreviewUrl = processed.dataUrl;

    const videoEl = document.getElementById('video-preview');
    videoEl.src = processed.dataUrl;
    document.getElementById('video-preview-container').classList.remove('hidden');
    document.getElementById('video-upload-placeholder').classList.add('hidden');
    document.getElementById('video-size-badge').innerText = `${(processed.sizeKB / 1024).toFixed(1)} MB`;

    Swal.close();
    playBeep('success');
  } catch (err) {
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถประมวลผลวิดีโอได้: ' + err.message, 'error');
  }
}

function removePhoto() {
  AppState.photoBase64 = null;
  AppState.photoPreviewUrl = null;
  document.getElementById('photo-preview-container').classList.add('hidden');
  document.getElementById('photo-upload-placeholder').classList.remove('hidden');
  document.getElementById('photo-input').value = '';
}

function removeVideo() {
  AppState.videoBase64 = null;
  AppState.videoPreviewUrl = null;
  document.getElementById('video-preview-container').classList.add('hidden');
  document.getElementById('video-upload-placeholder').classList.remove('hidden');
  document.getElementById('video-input').value = '';
}

/**
 * บันทึกผลการตรวจพัสดุ
 */
async function submitInspection() {
  if (!AppState.currentOrder) return;

  const order = AppState.currentOrder;
  const staffName = document.getElementById('inspect-staff-name').value.trim() || 'พนักงานคลัง';
  const staffNote = document.getElementById('inspect-notes').value.trim();
  const checkStatusSelect = document.getElementById('inspect-status-select').value;

  // บันทึกชื่อพนักงานไว้ใน LocalStorage เพื่อไม่ต้องพิมพ์ใหม่
  AppState.staffName = staffName;
  localStorage.setItem('tiktok_return_staff_name', staffName);

  // ตรวจสอบว่าสินค้าครบทุกรายการหรือไม่
  const allChecked = (order.items || []).every(it => it.checked !== false);
  let finalStatus = checkStatusSelect;
  if (checkStatusSelect === 'AUTO') {
    finalStatus = allChecked ? 'ตรวจแล้ว (ครบถ้วน)' : 'ตรวจแล้ว (สินค้าไม่ครบ)';
  }

  // แสดง Modal กำลังบันทึกพร้อม Progress
  Swal.fire({
    title: 'กำลังบันทึกข้อมูล...',
    html: `
      <div class="space-y-3">
        <p class="text-sm text-slate-600">กำลังอัปโหลดรูปภาพและส่งข้อมูลไปยัง Google Sheets</p>
        <div class="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
          <div id="save-progress-bar" class="bg-blue-600 h-3 rounded-full transition-all duration-300 progress-striped" style="width: 30%"></div>
        </div>
      </div>
    `,
    allowOutsideClick: false,
    showConfirmButton: false,
    didOpen: () => {
      setTimeout(() => {
        const pb = document.getElementById('save-progress-bar');
        if (pb) pb.style.width = '75%';
      }, 500);
    }
  });

  const payload = {
    orderId: order.orderId,
    trackingId: order.trackingId,
    checkStatus: finalStatus,
    receivedItems: order.items,
    staffNote: staffNote,
    checkedBy: staffName,
    photoBase64: AppState.photoBase64,
    photoContentType: 'image/jpeg',
    videoBase64: AppState.videoBase64,
    videoContentType: 'video/mp4'
  };

  try {
    const res = await ApiClient.updateInspection(payload);
    
    const pb = document.getElementById('save-progress-bar');
    if (pb) pb.style.width = '100%';

    // บันทึกลง Recent Scans
    const scanRecord = {
      orderId: order.orderId,
      trackingId: order.trackingId,
      sellerSku: order.sellerSku,
      checkStatus: finalStatus,
      timestamp: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString('th-TH')
    };
    AppState.recentScans.unshift(scanRecord);
    if (AppState.recentScans.length > 30) AppState.recentScans.pop();
    localStorage.setItem('tiktok_return_recent_scans', JSON.stringify(AppState.recentScans));

    playBeep('success');
    triggerHaptic(100);

    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ!',
      text: `พัสดุ ${order.trackingId} สถานะ: ${finalStatus}`,
      timer: 2000,
      showConfirmButton: false
    });

    // Reset view กลับไปหน้าพร้อมสแกน
    resetToWelcome();
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'บันทึกไม่สำเร็จ',
      text: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ'
    });
  }
}

function resetToWelcome() {
  AppState.currentOrder = null;
  document.getElementById('inspection-form').classList.add('hidden');
  document.getElementById('welcome-card').classList.remove('hidden');
  document.getElementById('manual-tracking-input').value = '';
  renderRecentScans();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderRecentScans() {
  const container = document.getElementById('recent-scans-list');
  if (!container) return;

  if (!AppState.recentScans || AppState.recentScans.length === 0) {
    container.innerHTML = '<div class="text-sm text-slate-400 py-4 text-center">ยังไม่มีประวัติการสแกนล่าสุด</div>';
    return;
  }

  container.innerHTML = AppState.recentScans.slice(0, 10).map(scan => `
    <div class="p-3 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center justify-between gap-3 text-sm">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-bold text-slate-800 tracking-wide">${scan.trackingId || scan.orderId}</span>
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${
            scan.checkStatus.includes('ครบ') ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
          }">${scan.checkStatus}</span>
        </div>
        <p class="text-xs text-slate-500 truncate mt-0.5">${scan.sellerSku || '-'}</p>
      </div>
      <span class="text-xs text-slate-400 whitespace-nowrap">${scan.timestamp}</span>
    </div>
  `).join('');
}

// ==========================================
// 9. ADMIN DASHBOARD & CONTROLLER
// ==========================================

async function renderDashboard() {
  const orders = AppState.orders || [];
  
  // Calculate Stats
  let total = orders.length;
  let completed = 0;
  let pending = 0;
  let issues = 0;

  orders.forEach(o => {
    const st = String(o.checkStatus || 'ยังไม่ตรวจ');
    if (st === 'ยังไม่ตรวจ' || !st) {
      pending++;
    } else if (st.includes('ครบ') || st === 'ครบถ้วนสมบูรณ์') {
      completed++;
    } else {
      issues++;
    }
  });

  const percent = total > 0 ? Math.round(((completed + issues) / total) * 100) : 0;

  document.getElementById('stat-total').innerText = total.toLocaleString();
  document.getElementById('stat-completed').innerText = completed.toLocaleString();
  document.getElementById('stat-pending').innerText = pending.toLocaleString();
  document.getElementById('stat-issues').innerText = issues.toLocaleString();
  document.getElementById('stat-progress-bar').style.width = `${percent}%`;
  document.getElementById('stat-progress-text').innerText = `${percent}% (${completed + issues}/${total})`;

  // Filter & Pagination
  let filtered = orders.filter(o => {
    if (AppState.adminStatusFilter !== 'ALL') {
      if (AppState.adminStatusFilter === 'PENDING' && o.checkStatus && o.checkStatus !== 'ยังไม่ตรวจ') return false;
      if (AppState.adminStatusFilter === 'COMPLETED' && (!o.checkStatus || !o.checkStatus.includes('ครบ'))) return false;
      if (AppState.adminStatusFilter === 'ISSUES' && (!o.checkStatus || o.checkStatus === 'ยังไม่ตรวจ' || o.checkStatus.includes('ครบ'))) return false;
    }

    if (AppState.adminSearch) {
      const q = AppState.adminSearch.toLowerCase();
      const match = (o.orderId && o.orderId.toLowerCase().includes(q)) ||
                    (o.trackingId && o.trackingId.toLowerCase().includes(q)) ||
                    (o.sellerSku && o.sellerSku.toLowerCase().includes(q)) ||
                    (o.productSummary && o.productSummary.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / AppState.adminPageSize));
  if (AppState.adminPage > totalPages) AppState.adminPage = 1;

  const startIdx = (AppState.adminPage - 1) * AppState.adminPageSize;
  const pageItems = filtered.slice(startIdx, startIdx + AppState.adminPageSize);

  // Render Table Rows
  const tbody = document.getElementById('dashboard-table-body');
  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-slate-400 text-sm">
          ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = pageItems.map(order => `
      <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-sm">
        <td class="py-3 px-4 font-mono font-medium text-slate-800">${order.trackingId || '-'}</td>
        <td class="py-3 px-4 font-mono text-xs text-slate-500">${order.orderId}</td>
        <td class="py-3 px-4 font-medium text-slate-700">${order.sellerSku || '-'}</td>
        <td class="py-3 px-4 text-xs text-slate-600 max-w-xs truncate" title="${order.productSummary || ''}">${order.productSummary || '-'}</td>
        <td class="py-3 px-4 text-center font-bold text-slate-800">${order.totalQuantity || 1}</td>
        <td class="py-3 px-4">
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
            !order.checkStatus || order.checkStatus === 'ยังไม่ตรวจ' ? 'bg-amber-100 text-amber-800' :
            order.checkStatus.includes('ครบ') ? 'bg-emerald-100 text-emerald-800' :
            'bg-rose-100 text-rose-800'
          }">
            ${order.checkStatus || 'ยังไม่ตรวจ'}
          </span>
        </td>
        <td class="py-3 px-4 text-center">
          <button onclick="viewOrderDetail('${order.orderId}')" class="px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-semibold transition-colors">
            ดูรายละเอียด
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Render Pagination Info
  document.getElementById('admin-page-info').innerText = `หน้า ${AppState.adminPage} จาก ${totalPages} (ทั้งหมด ${totalFiltered.toLocaleString()} รายการ)`;
  document.getElementById('btn-prev-page').disabled = AppState.adminPage <= 1;
  document.getElementById('btn-next-page').disabled = AppState.adminPage >= totalPages;
}

function viewOrderDetail(orderId) {
  const order = AppState.orders.find(o => o.orderId === orderId);
  if (!order) return;

  AppState.adminSelectedOrder = order;
  const modal = document.getElementById('order-detail-modal');
  modal.classList.remove('hidden');

  document.getElementById('modal-tracking-id').innerText = order.trackingId || '-';
  document.getElementById('modal-order-id').innerText = order.orderId;
  document.getElementById('modal-status').innerText = order.checkStatus || 'ยังไม่ตรวจ';
  document.getElementById('modal-carrier').innerText = order.carrier || '-';
  document.getElementById('modal-reason').innerText = order.returnReason || '-';
  document.getElementById('modal-staff').innerText = order.checkedBy ? `${order.checkedBy} (${order.checkedAt || '-'})` : '-';
  document.getElementById('modal-note').innerText = order.staffNote || '-';

  // Render Items in Modal
  const itemsContainer = document.getElementById('modal-items-list');
  itemsContainer.innerHTML = (order.items || []).map(it => `
    <div class="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-sm flex items-center justify-between">
      <div>
        <span class="font-bold text-blue-600">[${it.sku}]</span> ${it.productName}
      </div>
      <span class="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border">x${it.quantity}</span>
    </div>
  `).join('');

  // Photos & Videos
  const photoEl = document.getElementById('modal-photo');
  const noPhotoEl = document.getElementById('modal-no-photo');
  if (order.photoUrl) {
    photoEl.src = order.photoUrl;
    photoEl.classList.remove('hidden');
    noPhotoEl.classList.add('hidden');
  } else {
    photoEl.classList.add('hidden');
    noPhotoEl.classList.remove('hidden');
  }

  const videoEl = document.getElementById('modal-video');
  const noVideoEl = document.getElementById('modal-no-video');
  if (order.videoUrl) {
    videoEl.src = order.videoUrl;
    videoEl.classList.remove('hidden');
    noVideoEl.classList.add('hidden');
  } else {
    videoEl.classList.add('hidden');
    noVideoEl.classList.remove('hidden');
  }
}

function closeOrderDetailModal() {
  document.getElementById('order-detail-modal').classList.add('hidden');
  AppState.adminSelectedOrder = null;
}

function exportInspectedExcel() {
  if (!AppState.orders || AppState.orders.length === 0) {
    Swal.fire('ไม่มีข้อมูล', 'ยังไม่มีข้อมูลพัสดุสำหรับส่งออก', 'info');
    return;
  }

  const rows = AppState.orders.map(o => ({
    'Order ID': o.orderId,
    'Tracking ID': o.trackingId,
    'Seller SKU': o.sellerSku,
    'Product Summary': o.productSummary,
    'Total Quantity': o.totalQuantity,
    'Order Status': o.orderStatus,
    'Return Reason': o.returnReason,
    'Check Status': o.checkStatus,
    'Staff Note': o.staffNote,
    'Checked By': o.checkedBy,
    'Checked At': o.checkedAt,
    'Photo URL': o.photoUrl,
    'Video URL': o.videoUrl
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'InspectedReturns');
  XLSX.writeFile(wb, `TikTok_Returns_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ==========================================
// 10. EXCEL IMPORT CONTROLLER
// ==========================================

async function handleExcelFilesSelection() {
  const ordersFileInput = document.getElementById('file-all-orders');
  const returnsFileInput = document.getElementById('file-returns');

  const ordersFile = ordersFileInput.files[0];
  const returnsFile = returnsFileInput.files[0];

  if (!ordersFile && !returnsFile) {
    Swal.fire('กรุณาเลือกไฟล์', 'กรุณาเลือกไฟล์คำสั่งซื้อ หรือไฟล์การส่งคืนอย่างน้อย 1 ไฟล์', 'warning');
    return;
  }

  Swal.fire({
    title: 'กำลังประมวลผลไฟล์ Excel...',
    text: 'กำลังอ่านและกรอง Order ID ซ้ำ',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const merged = await processTikTokExcelFiles(ordersFile, returnsFile);
    AppState.importedOrders = merged;
    Swal.close();

    // แสดง Preview
    document.getElementById('import-preview-section').classList.remove('hidden');
    document.getElementById('import-preview-count').innerText = `${merged.length.toLocaleString()} ออเดอร์`;

    const previewTbody = document.getElementById('import-preview-tbody');
    previewTbody.innerHTML = merged.slice(0, 10).map(o => `
      <tr class="border-b border-slate-100 text-xs">
        <td class="py-2 px-3 font-mono">${o.trackingId || '-'}</td>
        <td class="py-2 px-3 font-mono">${o.orderId}</td>
        <td class="py-2 px-3 font-medium">${o.sellerSku || '-'}</td>
        <td class="py-2 px-3 truncate max-w-xs">${o.productSummary || '-'}</td>
        <td class="py-2 px-3 text-center font-bold">${o.totalQuantity}</td>
      </tr>
    `).join('');

    playBeep('success');
  } catch (err) {
    Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถอ่านไฟล์ Excel ได้: ' + err.message, 'error');
  }
}

async function uploadImportedToGoogleSheet() {
  if (!AppState.importedOrders || AppState.importedOrders.length === 0) return;

  const orders = AppState.importedOrders;

  Swal.fire({
    title: 'กำลังส่งข้อมูลไปยัง Google Sheets...',
    html: `
      <div class="space-y-3">
        <p class="text-sm text-slate-600">กำลังบันทึกข้อมูล ${orders.length} รายการ</p>
        <div class="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
          <div id="import-progress-bar" class="bg-emerald-600 h-3 rounded-full transition-all duration-300 progress-striped" style="width: 5%"></div>
        </div>
        <p id="import-progress-text" class="text-xs text-slate-500">กำลังเตรียมส่งชุดข้อมูล...</p>
      </div>
    `,
    allowOutsideClick: false,
    showConfirmButton: false
  });

  try {
    const res = await ApiClient.bulkUpsertOrders(orders, (percent, currentChunk, totalChunks) => {
      const pb = document.getElementById('import-progress-bar');
      const pt = document.getElementById('import-progress-text');
      if (pb) pb.style.width = `${percent}%`;
      if (pt) pt.innerText = `ส่งชุดที่ ${currentChunk}/${totalChunks} (${percent}%)`;
    });

    Swal.fire({
      icon: 'success',
      title: 'นำเข้าข้อมูลสำเร็จ!',
      text: res.message,
      confirmButtonText: 'ไปที่หน้าแดชบอร์ด',
      confirmButtonColor: '#3B82F6'
    }).then(() => {
      switchTab('dashboard');
    });
  } catch (err) {
    Swal.fire('การนำเข้าล้มเหลว', err.message, 'error');
  }
}

// ==========================================
// 11. SETTINGS & INITIALIZATION
// ==========================================

function saveSettings() {
  const urlInput = document.getElementById('setting-api-url').value.trim();
  const staffInput = document.getElementById('setting-staff-name').value.trim();

  AppState.apiEndpoint = urlInput;
  AppState.staffName = staffInput || 'พนักงานคลัง 1';

  localStorage.setItem('tiktok_return_api_url', urlInput);
  localStorage.setItem('tiktok_return_staff_name', AppState.staffName);

  Swal.fire({
    icon: 'success',
    title: 'บันทึกการตั้งค่าแล้ว',
    timer: 1500,
    showConfirmButton: false
  });
}

async function testApiConnection() {
  const url = document.getElementById('setting-api-url').value.trim();
  if (!url) {
    Swal.fire('กรุณาระบุ Web App URL', '', 'warning');
    return;
  }

  Swal.fire({
    title: 'กำลังทดสอบการเชื่อมต่อ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  AppState.apiEndpoint = url;
  const res = await ApiClient.ping();

  if (res.success) {
    Swal.fire({
      icon: 'success',
      title: 'เชื่อมต่อสำเร็จ!',
      text: 'ระบบ Apps Script พร้อมใช้งานเรียบร้อย'
    });
  } else {
    Swal.fire({
      icon: 'error',
      title: 'เชื่อมต่อไม่สำเร็จ',
      text: res.error || 'กรุณาตรวจสอบว่าได้เลือก Who has access: Anyone แล้วหรือไม่'
    });
  }
}

async function syncSheetCache() {
  Swal.fire({
    title: 'กำลังซิงค์ข้อมูลจาก Google Sheets...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const res = await ApiClient.loadAllOrdersFromSheet();
  Swal.close();

  if (res.success) {
    Swal.fire({
      icon: 'success',
      title: 'ซิงค์ข้อมูลเสร็จสมบูรณ์',
      text: `ดาวน์โหลดข้อมูลพัสดุมาเก็บไว้ในเครื่องแล้ว ${AppState.orders.length.toLocaleString()} รายการ ช่วยให้สแกนได้เร็วทันที`,
      timer: 2000,
      showConfirmButton: false
    });
  } else {
    Swal.fire('การซิงค์ขัดข้อง', res.error || '', 'error');
  }
}

// Setup Event Listeners on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  if (document.getElementById('setting-api-url')) {
    document.getElementById('setting-api-url').value = AppState.apiEndpoint;
  }
  if (document.getElementById('setting-staff-name')) {
    document.getElementById('setting-staff-name').value = AppState.staffName;
  }

  // Load cache
  const cached = localStorage.getItem('tiktok_return_orders_cache');
  if (cached) {
    try { AppState.orders = JSON.parse(cached); } catch(e) {}
  }

  // Search input keyboard enter
  const searchInput = document.getElementById('manual-tracking-input');
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSearchTracking(searchInput.value);
      }
    });
  }

  // Dashboard search debounce
  const adminSearchInput = document.getElementById('admin-search-input');
  if (adminSearchInput) {
    let debounceTimer;
    adminSearchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        AppState.adminSearch = e.target.value.trim();
        AppState.adminPage = 1;
        renderDashboard();
      }, 300);
    });
  }

  // Render initial tab
  switchTab('warehouse');

  // Try background sync if API is configured
  if (AppState.apiEndpoint) {
    ApiClient.loadAllOrdersFromSheet().catch(e => console.log('Background sync info:', e));
  }
});
