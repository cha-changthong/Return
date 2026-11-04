/**
 * TikTok Return Parcel Inspection System
 * Admin Portal Engine (admin.js)
 */

const API_URL = "https://script.google.com/macros/s/AKfycbxs3LzbtEOj2036lhcXrZOtr9hkh0Dg2349rSjQ0H-hX3maVZUgrVEt3N_3FsreWFeb/exec";

const AdminState = {
  currentTab: 'dashboard', // 'dashboard' | 'import'
  orders: [],
  filteredOrders: [],
  page: 1,
  pageSize: 20,
  searchQuery: '',
  statusFilter: 'ALL',
  
  importedOrders: []
};

// ==========================================
// 1. NAVIGATION & TAB SWITCHING
// ==========================================
function switchAdminTab(tabName) {
  AdminState.currentTab = tabName;
  
  const tabDashboard = document.getElementById('admin-tab-dashboard');
  const tabImport = document.getElementById('admin-tab-import');
  
  const navDashboard = document.getElementById('nav-tab-dashboard');
  const navImport = document.getElementById('nav-tab-import');

  if (tabName === 'dashboard') {
    tabDashboard.classList.remove('hidden');
    tabImport.classList.add('hidden');
    
    navDashboard.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5 transition-all';
    navImport.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 transition-all';
    
    renderDashboard();
  } else {
    tabDashboard.classList.add('hidden');
    tabImport.classList.remove('hidden');
    
    navDashboard.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 transition-all';
    navImport.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5 transition-all';
  }
}

// ==========================================
// 2. DATA SYNC FROM GOOGLE SHEETS (HYBRID JSONP / POST)
// ==========================================
function fetchJSONP(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_admin_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    let timer = null;

    window[callbackName] = function(data) {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
    }

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP Timeout'));
    }, timeout);

    script.onerror = function() {
      cleanup();
      reject(new Error('JSONP Script Error'));
    };

    const separator = url.includes('?') ? '&' : '?';
    script.src = `${url}${separator}callback=${callbackName}&_t=${Date.now()}`;
    document.head.appendChild(script);
  });
}

async function apiFetchAdminOrders() {
  // 1. Try JSONP (Zero CORS, Zero 404 redirect issues)
  try {
    const data = await fetchJSONP(`${API_URL}?action=getOrders&limit=5000`, 10000);
    if (data && data.success) return data;
  } catch(e) {
    console.warn('JSONP fetch attempt failed, trying POST fallback:', e);
  }

  // 2. Fallback to POST fetch
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getOrders', limit: 5000 })
    });
    const text = await res.text();
    return JSON.parse(text);
  } catch(e) {
    console.error('All fetch methods failed:', e);
    throw e;
  }
}

async function refreshOrdersFromSheet(showToast = false) {
  const icon = document.getElementById('admin-refresh-icon');
  if (icon) icon.classList.add('animate-spin');

  try {
    const data = await apiFetchAdminOrders();

    if (data && data.success && data.orders) {
      AdminState.orders = data.orders;
      localStorage.setItem('admin_cached_orders', JSON.stringify(data.orders));
      applyFilters();
      
      if (showToast) {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: `ดึงข้อมูลแล้ว ${data.orders.length} รายการ`,
          showConfirmButton: false,
          timer: 1500
        });
      }
    }
  } catch (err) {
    console.warn('Failed to fetch orders, using cache:', err);
    const cached = localStorage.getItem('admin_cached_orders');
    if (cached) {
      AdminState.orders = JSON.parse(cached);
      applyFilters();
    }
  } finally {
    if (icon) icon.classList.remove('animate-spin');
  }
}

// ==========================================
// 3. DATE UTILITIES & DEADLINE TRACKING (10 DAYS)
// ==========================================
function parseExcelDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    const yr = val.getFullYear();
    return (yr >= 2020 && yr <= 2035) ? val : null;
  }
  if (typeof val === 'number') {
    // Excel date serial number (e.g. ~44000 to ~50000)
    if (val < 10000 || val > 100000) return null;
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (isNaN(date.getTime())) return null;
    const yr = date.getFullYear();
    return (yr >= 2020 && yr <= 2035) ? date : null;
  }
  const str = String(val).trim();
  if (!str || str === '-' || str === 'N/A') return null;

  // Format 1: YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    if (year < 2020 || year > 2035) return null;
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  // Format 2: DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    if (year < 2020 || year > 2035) return null;
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function formatDateOnly(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${year}-${month}-${day}`;
}

function formatDateTime(d) {
  return formatDateOnly(d);
}

function getOrderOverdueInfo(order) {
  const checkStatus = String(order.checkStatus || 'ยังไม่ตรวจ').trim();
  const isPending = !checkStatus || checkStatus === 'ยังไม่ตรวจ';
  
  const returnTimeStr = order.returnTime || '';
  const deadlineAtStr = order.deadlineAt || '';
  
  let deadline = null;
  if (deadlineAtStr) {
    deadline = parseExcelDate(deadlineAtStr);
  }
  
  const returnDate = parseExcelDate(returnTimeStr);
  if (!deadline && returnDate) {
    deadline = new Date(returnDate.getFullYear(), returnDate.getMonth(), returnDate.getDate() + 10);
  }
  
  if (!deadline) {
    return {
      isOverdue: false,
      daysOverdue: 0,
      deadlineStr: deadlineAtStr ? deadlineAtStr.split(' ')[0] : '-',
      returnTimeStr: returnTimeStr ? returnTimeStr.split(' ')[0] : '-'
    };
  }
  
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const deadlineDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const diffMs = now.getTime() - deadlineDay.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const isOverdue = isPending && (diffDays > 0);
  
  return {
    isOverdue,
    daysOverdue: Math.max(0, diffDays),
    deadlineStr: formatDateOnly(deadline),
    returnTimeStr: returnDate ? formatDateOnly(returnDate) : (returnTimeStr ? returnTimeStr.split(' ')[0] : '-')
  };
}

// ==========================================
// 4. DASHBOARD RENDERING & FILTERS
// ==========================================
function applyFilters() {
  const q = (document.getElementById('admin-search-input')?.value || '').trim().toLowerCase();
  const st = document.getElementById('admin-status-filter')?.value || 'ALL';

  AdminState.searchQuery = q;
  AdminState.statusFilter = st;

  AdminState.filteredOrders = AdminState.orders.filter(o => {
    const status = String(o.checkStatus || 'ยังไม่ตรวจ');
    const ov = getOrderOverdueInfo(o);
    const isPending = !status || status === 'ยังไม่ตรวจ';
    const isCompleted = (status.includes('ครบ') && !status.includes('ไม่ครบ'));
    const isIssue = !isPending && !isCompleted;
    const isOverdue = ov.isOverdue;
    const isPendingNotOverdue = isPending && !isOverdue;

    // Status Filter
    if (st !== 'ALL') {
      if (st === 'PENDING' && !isPendingNotOverdue) return false;
      if (st === 'OVERDUE' && !isOverdue) return false;
      if (st === 'COMPLETED' && !isCompleted) return false;
      if (st === 'ISSUES' && !isIssue) return false;
    }

    // Search Query
    if (q) {
      const match = (o.orderId && o.orderId.toLowerCase().includes(q)) ||
                    (o.trackingId && o.trackingId.toLowerCase().includes(q)) ||
                    (o.sellerSku && o.sellerSku.toLowerCase().includes(q)) ||
                    (o.productSummary && o.productSummary.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  AdminState.page = 1;
  renderDashboard();
}

function renderDashboard() {
  const orders = AdminState.orders;
  const filtered = AdminState.filteredOrders;

  // Stats Counters
  let total = orders.length;
  let completed = 0;
  let issues = 0;
  let pendingNotOverdue = 0;
  let overdue = 0;

  orders.forEach(o => {
    const s = String(o.checkStatus || 'ยังไม่ตรวจ');
    const isPending = !s || s === 'ยังไม่ตรวจ';
    const isCompleted = (s.includes('ครบ') && !s.includes('ไม่ครบ'));
    
    if (isPending) {
      const ov = getOrderOverdueInfo(o);
      if (ov.isOverdue) {
        overdue++;
      } else {
        pendingNotOverdue++;
      }
    } else if (isCompleted) {
      completed++;
    } else {
      issues++;
    }
  });

  const checkedCount = completed + issues;
  const percent = total > 0 ? Math.round((checkedCount / total) * 100) : 0;

  document.getElementById('stat-total').innerText = total.toLocaleString();
  document.getElementById('stat-completed').innerText = completed.toLocaleString();
  document.getElementById('stat-issues').innerText = issues.toLocaleString();
  document.getElementById('stat-pending').innerText = pendingNotOverdue.toLocaleString();
  
  const overdueEl = document.getElementById('stat-overdue');
  if (overdueEl) {
    overdueEl.innerText = overdue.toLocaleString();
    const cardOverdue = document.getElementById('card-stat-overdue');
    if (cardOverdue) {
      if (overdue > 0) {
        cardOverdue.className = 'bg-rose-50 p-4 sm:p-5 rounded-2xl border-2 border-rose-500 shadow-md cursor-pointer hover:shadow-lg active:scale-95 transition-all group relative overflow-hidden ring-2 ring-rose-200';
      } else {
        cardOverdue.className = 'bg-white p-4 sm:p-5 rounded-2xl border border-rose-200 shadow-sm cursor-pointer hover:border-rose-500 hover:shadow-md active:scale-95 transition-all group relative overflow-hidden';
      }
    }
  }

  document.getElementById('stat-progress-bar').style.width = `${percent}%`;
  document.getElementById('stat-progress-text').innerText = `${percent}% (${checkedCount}/${total})`;

  // Pagination & Table
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / AdminState.pageSize));
  if (AdminState.page > totalPages) AdminState.page = 1;

  const startIdx = (AdminState.page - 1) * AdminState.pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + AdminState.pageSize);

  const tbody = document.getElementById('admin-table-body');
  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-10 text-center text-slate-400 text-sm">ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(o => {
      const ov = getOrderOverdueInfo(o);
      const isPending = !o.checkStatus || o.checkStatus === 'ยังไม่ตรวจ';
      const isCompleted = (o.checkStatus && o.checkStatus.includes('ครบ') && !o.checkStatus.includes('ไม่ครบ'));

      let statusBadge = '';
      if (ov.isOverdue) {
        statusBadge = `
          <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-rose-600 text-white shadow-md shadow-rose-500/40 animate-pulse ring-2 ring-rose-400">
            <span class="w-2 h-2 rounded-full bg-white animate-ping"></span>
            🚨 เกินกำหนด (${ov.daysOverdue} วัน)
          </span>
        `;
      } else if (isPending) {
        statusBadge = `
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
            ยังไม่ตรวจ
          </span>
        `;
      } else if (isCompleted) {
        statusBadge = `
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
            ${o.checkStatus}
          </span>
        `;
      } else {
        statusBadge = `
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
            ${o.checkStatus}
          </span>
        `;
      }

      return `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-sm ${ov.isOverdue ? 'bg-rose-50/40' : ''}">
          <td class="py-3 px-4 font-mono font-bold text-slate-800">${o.trackingId || '-'}</td>
          <td class="py-3 px-4 font-mono text-xs text-slate-500">${o.orderId}</td>
          <td class="py-3 px-4 font-medium text-slate-700">${o.sellerSku || '-'}</td>
          <td class="py-3 px-4 text-xs text-slate-600 max-w-xs truncate" title="${o.productSummary || ''}">${o.productSummary || '-'}</td>
          <td class="py-3 px-4 text-center font-bold text-slate-800">${o.totalQuantity || 1}</td>
          <td class="py-3 px-4 text-xs">
            ${ov.returnTimeStr && ov.returnTimeStr !== '-' ? `
              <div class="text-slate-700 font-semibold">${ov.returnTimeStr}</div>
              <div class="text-[11px] ${ov.isOverdue ? 'text-rose-600 font-black' : 'text-slate-400'}">
                ครบกำหนด: ${ov.deadlineStr || '-'}
              </div>
            ` : `<span class="text-slate-400">-</span>`}
          </td>
          <td class="py-3 px-4">
            ${statusBadge}
          </td>
          <td class="py-3 px-4 text-center">
            <button onclick="viewDetails('${o.orderId}')" class="px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-semibold transition-colors">
              ดูรายละเอียด
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('admin-page-info').innerText = `หน้า ${AdminState.page} จาก ${totalPages} (ทั้งหมด ${totalFiltered.toLocaleString()} รายการ)`;
  document.getElementById('btn-prev').disabled = AdminState.page <= 1;
  document.getElementById('btn-next').disabled = AdminState.page >= totalPages;
}

function changePage(delta) {
  AdminState.page += delta;
  renderDashboard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setAdminFilter(status) {
  const select = document.getElementById('admin-status-filter');
  if (select) {
    select.value = status;
    applyFilters();
  }
}

function getDriveThumbnailUrl(url, size = 'w800') {
  if (!url) return '';
  const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=${size}`;
  }
  return url;
}

function getDriveViewUrl(url) {
  if (!url) return '';
  const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/file/d/${match[1]}/view?usp=sharing`;
  }
  return url;
}

function getDrivePreviewUrl(url) {
  if (!url) return '';
  const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/file/d/${match[1]}/preview`;
  }
  return url;
}

// ==========================================
// 4. ORDER DETAIL MODAL
// ==========================================
function viewDetails(orderId) {
  const order = AdminState.orders.find(o => o.orderId === orderId);
  if (!order) return;

  const modal = document.getElementById('order-modal');
  modal.classList.remove('hidden');

  document.getElementById('modal-tracking-id').innerText = order.trackingId || order.orderId;
  document.getElementById('modal-tracking-info').innerText = order.trackingId || '-';
  document.getElementById('modal-order-id').innerText = order.orderId;
  
  const statusEl = document.getElementById('modal-status');
  statusEl.innerText = order.checkStatus || 'ยังไม่ตรวจ';
  statusEl.className = (order.checkStatus && order.checkStatus.includes('ครบ')) ? 'font-bold text-emerald-600' :
                       (!order.checkStatus || order.checkStatus === 'ยังไม่ตรวจ' ? 'font-bold text-amber-600' : 'font-bold text-rose-600');

  document.getElementById('modal-checked-at').innerText = order.checkedAt || '-';
  document.getElementById('modal-total-qty').innerText = `${order.totalQuantity || 1} ชิ้น`;

  const ov = getOrderOverdueInfo(order);
  const returnTimeEl = document.getElementById('modal-return-time');
  const deadlineEl = document.getElementById('modal-deadline');
  if (returnTimeEl) returnTimeEl.innerText = (ov.returnTimeStr && ov.returnTimeStr !== '-') ? ov.returnTimeStr : '-';
  if (deadlineEl) {
    if (ov.isOverdue) {
      deadlineEl.innerHTML = `<span class="text-rose-600 font-black animate-pulse">🚨 ${ov.deadlineStr} (เกินกำหนด ${ov.daysOverdue} วัน)</span>`;
    } else {
      deadlineEl.innerText = (ov.deadlineStr && ov.deadlineStr !== '-') ? ov.deadlineStr : '-';
    }
  }

  // Display only Seller SKU and Quantity
  const itemsContainer = document.getElementById('modal-items-list');
  const items = order.items || [];
  if (items.length === 0) {
    itemsContainer.innerHTML = `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-center justify-between">
        <span class="font-bold text-blue-600">[${order.sellerSku || 'SKU'}]</span>
        <span class="font-bold text-slate-800 bg-white px-2.5 py-1 rounded-lg border shadow-sm">จำนวน: ${order.totalQuantity || 1}</span>
      </div>
    `;
  } else {
    itemsContainer.innerHTML = items.map(it => `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-center justify-between">
        <div>
          <span class="font-bold text-blue-600 text-sm">[${it.sku || order.sellerSku || 'SKU'}]</span>
          ${it.variation ? `<span class="text-slate-500 ml-1 font-normal">(${it.variation})</span>` : ''}
        </div>
        <span class="font-bold text-slate-800 bg-white px-2.5 py-1 rounded-lg border shadow-sm">จำนวน: ${it.quantity || 1}</span>
      </div>
    `).join('');
  }

  // Photo
  const photoEl = document.getElementById('modal-photo');
  const noPhotoEl = document.getElementById('modal-no-photo');
  if (order.photoUrl) {
    const thumbUrl = getDriveThumbnailUrl(order.photoUrl, 'w1000');
    photoEl.src = thumbUrl;
    photoEl.onclick = () => window.open(getDriveViewUrl(order.photoUrl), '_blank');
    photoEl.title = "คลิกเพื่อดูรูปขนาดเต็ม";
    photoEl.classList.remove('hidden');
    photoEl.classList.add('cursor-pointer', 'hover:opacity-90', 'transition-opacity');
    noPhotoEl.classList.add('hidden');
  } else {
    photoEl.classList.add('hidden');
    noPhotoEl.classList.remove('hidden');
  }

  // Video: Use iframe for Drive preview or video tag for direct/blob
  const videoIframe = document.getElementById('modal-video-iframe');
  const videoEl = document.getElementById('modal-video');
  const noVideoEl = document.getElementById('modal-no-video');

  if (order.videoUrl) {
    const isDrive = order.videoUrl.includes('drive.google.com') || order.videoUrl.includes('drive.usercontent.google.com');
    if (isDrive) {
      videoIframe.src = getDrivePreviewUrl(order.videoUrl);
      videoIframe.classList.remove('hidden');
      videoEl.classList.add('hidden');
    } else {
      videoEl.src = order.videoUrl;
      videoEl.classList.remove('hidden');
      videoIframe.classList.add('hidden');
    }
    noVideoEl.classList.add('hidden');
  } else {
    if (videoIframe) videoIframe.src = '';
    if (videoEl) videoEl.src = '';
    videoIframe.classList.add('hidden');
    videoEl.classList.add('hidden');
    noVideoEl.classList.remove('hidden');
  }
}

function closeModal() {
  const modal = document.getElementById('order-modal');
  modal.classList.add('hidden');
  const videoIframe = document.getElementById('modal-video-iframe');
  const videoEl = document.getElementById('modal-video');
  if (videoIframe) videoIframe.src = '';
  if (videoEl) videoEl.src = '';
}

// ==========================================
// 5. EXPORT TO EXCEL
// ==========================================
function exportToExcel() {
  if (!AdminState.orders || AdminState.orders.length === 0) {
    Swal.fire('ไม่มีข้อมูล', 'ยังไม่มีรายการสำหรับส่งออก', 'info');
    return;
  }

  const rows = AdminState.orders.map(o => {
    const ov = getOrderOverdueInfo(o);
    return {
      'Order ID': o.orderId,
      'Tracking ID': o.trackingId,
      'Seller SKU': o.sellerSku,
      'Product Summary': o.productSummary,
      'Total Quantity': o.totalQuantity,
      'Order Status': o.orderStatus,
      'Return Reason': o.returnReason,
      'Return Time': o.returnTime || ov.returnTimeStr || '',
      'Deadline (10 Days)': o.deadlineAt || ov.deadlineStr || '',
      'Check Status': ov.isOverdue ? `เกินกำหนด (${ov.daysOverdue} วัน)` : (o.checkStatus || 'ยังไม่ตรวจ'),
      'Staff Note': o.staffNote,
      'Checked By': o.checkedBy,
      'Checked At': o.checkedAt,
      'Photo URL': o.photoUrl,
      'Video URL': o.videoUrl
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TikTokReturns');
  XLSX.writeFile(wb, `TikTok_Returns_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ==========================================
// 6. EXCEL MERGE & IMPORT ENGINE
// ==========================================
async function processSelectedFiles() {
  const fOrders = document.getElementById('file-all-orders').files[0];
  const fReturns = document.getElementById('file-returns').files[0];

  if (!fOrders && !fReturns) {
    Swal.fire('กรุณาเลือกไฟล์', 'กรุณาเลือกไฟล์คำสั่งซื้อ หรือไฟล์การส่งคืนอย่างน้อย 1 ไฟล์', 'warning');
    return;
  }

  Swal.fire({
    title: 'กำลังประมวลผลไฟล์ Excel...',
    text: 'กำลังรวมข้อมูลและกรอง Order ID ซ้ำ',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const readWorkbook = async (file) => {
    const data = await file.arrayBuffer();
    return XLSX.read(data, { type: 'array', cellDates: true });
  };

  try {
    const ordersMap = new Map();

    // 1. Parse All Orders
    if (fOrders) {
      const wb = await readWorkbook(fOrders);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (rows.length > 0) {
        const h = rows[0].map(c => String(c || '').trim());
        // ไฟล์คำสั่งซื้อทั้งหมด: เริ่มต้นแถวที่ 3 ใน Excel (index 2)
        const startRow = 2;

        const cOrderId = h.indexOf('Order ID') !== -1 ? h.indexOf('Order ID') : 0;
        const cTracking = h.indexOf('Tracking ID');
        const cSku = h.indexOf('Seller SKU');
        const cProd = h.indexOf('Product Name');
        const cVar = h.indexOf('Variation');
        const cQty = h.indexOf('Quantity');
        const cStatus = h.indexOf('Order Status');
        const cCarrier = h.indexOf('Shipping Provider Name');
        const cBuyer = h.indexOf('Buyer Username');

        // ไฟล์คำสั่งซื้อทั้งหมด: ดึงจากคอลัมน์ AB Shipped Time (index 27) เท่านั้น!
        let cShipped1 = h.indexOf('Shipped Time');
        if (cShipped1 === -1) cShipped1 = h.findIndex(col => col && col.toLowerCase().includes('shipped time'));
        if (cShipped1 === -1 && h.length > 27) cShipped1 = 27; // Column AB

        for (let i = startRow; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[cOrderId]) continue;
          const orderId = String(r[cOrderId]).trim();
          const trackingId = cTracking !== -1 && r[cTracking] ? String(r[cTracking]).trim() : '';
          const sku = cSku !== -1 && r[cSku] ? String(r[cSku]).trim() : '';
          const prodName = cProd !== -1 && r[cProd] ? String(r[cProd]).trim() : '';
          const varName = cVar !== -1 && r[cVar] ? String(r[cVar]).trim() : '';
          const qty = cQty !== -1 && !isNaN(parseInt(r[cQty])) ? parseInt(r[cQty]) : 1;
          const status = cStatus !== -1 && r[cStatus] ? String(r[cStatus]).trim() : '';
          const carrier = cCarrier !== -1 && r[cCarrier] ? String(r[cCarrier]).trim() : '';
          const buyer = cBuyer !== -1 && r[cBuyer] ? String(r[cBuyer]).trim() : '';
          
          // ดึงจากคอลัมน์ AB (Shipped Time)
          let rawTime1 = '';
          if (cShipped1 !== -1 && r[cShipped1]) {
            rawTime1 = r[cShipped1];
          } else if (r[27]) {
            rawTime1 = r[27];
          }

          const item = { sku, productName: prodName, variation: varName, quantity: qty, checked: true };

          if (!ordersMap.has(orderId)) {
            ordersMap.set(orderId, {
              orderId, trackingId, orderStatus: status, carrier, buyerUsername: buyer,
              returnReason: '', returnStatus: '', items: [item], checkStatus: 'ยังไม่ตรวจ',
              returnTime: rawTime1
            });
          } else {
            const rec = ordersMap.get(orderId);
            if (trackingId && !rec.trackingId) rec.trackingId = trackingId;
            if (!rec.returnTime && rawTime1) rec.returnTime = rawTime1;
            rec.items.push(item);
          }
        }
      }
    }

    // 2. Parse Returns File
    if (fReturns) {
      const wb = await readWorkbook(fReturns);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (rows.length > 0) {
        const h = rows[0].map(c => String(c || '').trim());
        // ไฟล์การส่งคืนสินค้า: เริ่มแถวที่ 2 ใน Excel (index 1)
        const startRow = 1;

        const cOrderId = h.indexOf('Order ID') !== -1 ? h.indexOf('Order ID') : 1;
        const cTracking = h.indexOf('Return Logistics Tracking ID');
        const cSku = h.indexOf('Seller SKU');
        const cProd = h.indexOf('Product Name');
        const cQty = h.indexOf('Return Quantity');
        const cReason = h.indexOf('Return Reason');
        const cStatus = h.indexOf('Return Status');

        // ไฟล์การส่งคืนสินค้า: ดึงจากคอลัมน์ M Time Requested (index 12) เท่านั้น!
        let cTimeReq2 = h.indexOf('Time Requested');
        if (cTimeReq2 === -1) cTimeReq2 = h.findIndex(col => col && (col.toLowerCase().includes('time requested') || col.toLowerCase().includes('request time')));
        if (cTimeReq2 === -1 && h.length > 12) cTimeReq2 = 12; // Column M

        for (let i = startRow; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[cOrderId]) continue;
          const orderId = String(r[cOrderId]).trim();
          const retTracking = cTracking !== -1 && r[cTracking] ? String(r[cTracking]).trim() : '';
          const sku = cSku !== -1 && r[cSku] ? String(r[cSku]).trim() : '';
          const prodName = cProd !== -1 && r[cProd] ? String(r[cProd]).trim() : '';
          const qty = cQty !== -1 && !isNaN(parseInt(r[cQty])) ? parseInt(r[cQty]) : 1;
          const reason = cReason !== -1 && r[cReason] ? String(r[cReason]).trim() : '';
          const status = cStatus !== -1 && r[cStatus] ? String(r[cStatus]).trim() : '';

          // ดึงจากคอลัมน์ M (Time Requested)
          let rawTime2 = '';
          if (cTimeReq2 !== -1 && r[cTimeReq2]) {
            rawTime2 = r[cTimeReq2];
          } else if (r[12]) {
            rawTime2 = r[12];
          }

          const item = { sku, productName: prodName, variation: '', quantity: qty, checked: true };

          if (ordersMap.has(orderId)) {
            const rec = ordersMap.get(orderId);
            if (retTracking && !rec.trackingId) rec.trackingId = retTracking;
            if (reason) rec.returnReason = reason;
            if (status) rec.returnStatus = status;
            if (rawTime2) rec.returnTime = rawTime2;
            if (sku && !rec.items.some(it => it.sku === sku)) rec.items.push(item);
          } else {
            ordersMap.set(orderId, {
              orderId, trackingId: retTracking, orderStatus: '', carrier: '', buyerUsername: '',
              returnReason: reason, returnStatus: status, items: [item], checkStatus: 'ยังไม่ตรวจ',
              returnTime: rawTime2
            });
          }
        }
      }
    }

    // Format Aggregated List & Deduplicate Against Existing Database
    const existingOrdersMap = new Map();
    (AdminState.orders || []).forEach(o => {
      const oid = String(o.orderId || '').trim();
      if (oid) existingOrdersMap.set(oid, o);
    });

    const ordersToImport = [];
    let newCount = 0;
    let backfillCount = 0;
    let duplicateCount = 0;

    ordersMap.forEach((data, orderId) => {
      const skusSummary = data.items.map(it => `${it.sku || 'N/A'} (x${it.quantity})`).join(', ');
      const productSummary = data.items.map(it => `${it.productName || 'สินค้า'} x ${it.quantity}`).join(' | ');
      const totalQty = data.items.reduce((s, it) => s + it.quantity, 0);

      // แปลงวันที่และคำนวณวันครบกำหนด (+10 วัน) เฉพาะวันที่ YYYY-MM-DD ตัดเวลาออก
      let returnTimeStr = '';
      let deadlineStr = '';
      if (data.returnTime) {
        const parsedD = parseExcelDate(data.returnTime);
        if (parsedD) {
          returnTimeStr = formatDateOnly(parsedD);
          const deadlineD = new Date(parsedD.getFullYear(), parsedD.getMonth(), parsedD.getDate() + 10);
          deadlineStr = formatDateOnly(deadlineD);
        }
      }

      const cleanOrderId = String(orderId).trim();
      const existing = existingOrdersMap.get(cleanOrderId);

      const record = {
        orderId: cleanOrderId,
        trackingId: data.trackingId || '',
        sellerSku: skusSummary,
        productSummary,
        items: data.items,
        totalQuantity: totalQty,
        orderStatus: data.orderStatus,
        returnReason: data.returnReason,
        returnStatus: data.returnStatus,
        carrier: data.carrier,
        buyerUsername: data.buyerUsername,
        checkStatus: data.checkStatus,
        staffNote: '', checkedBy: '', checkedAt: '', photoUrl: '', videoUrl: '',
        returnTime: returnTimeStr,
        deadlineAt: deadlineStr
      };

      if (existing) {
        // รายการเดิมที่มีในระบบแล้ว
        // ถ้าไฟล์นำเข้ามีวันที่ (returnTimeStr)
        // และ (ในระบบยังไม่มี หรือเป็นวันที่ผิดปกติ หรือมีค่าเดิมไม่ตรงกับไฟล์นำเข้า)
        const existingReturnTime = String(existing.returnTime || '').trim();
        const existingValidDate = parseExcelDate(existingReturnTime);
        const existingDateStr = existingValidDate ? formatDateOnly(existingValidDate) : '';

        if (returnTimeStr && (!existingDateStr || existingDateStr !== returnTimeStr)) {
          record._type = 'BACKFILL';
          ordersToImport.push(record);
          backfillCount++;
        } else {
          duplicateCount++;
        }
      } else {
        // รายการใหม่ที่ไม่เคยมีในระบบ
        record._type = 'NEW';
        ordersToImport.push(record);
        newCount++;
      }
    });

    AdminState.importedOrders = ordersToImport;
    Swal.close();

    if (ordersToImport.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'ไม่มีข้อมูลที่ต้องนำเข้า',
        text: `คำสั่งซื้อทั้งหมด ${ordersMap.size} รายการ มีอยู่ในระบบและมีวันที่ครบถ้วนแล้ว (ระบบข้ามข้อมูลซ้ำทั้งหมด)`
      });
      return;
    }

    // Render Preview
    document.getElementById('import-preview-section').classList.remove('hidden');
    let previewCountHtml = '';
    if (newCount > 0) {
      previewCountHtml += `<span class="text-emerald-600 font-bold">${newCount.toLocaleString()} รายการใหม่</span>`;
    }
    if (backfillCount > 0) {
      if (previewCountHtml) previewCountHtml += ` <span class="text-slate-300">|</span> `;
      previewCountHtml += `<span class="text-blue-600 font-bold">🔄 เติมวันที่ให้รายการเดิม ${backfillCount.toLocaleString()} รายการ</span>`;
    }
    if (duplicateCount > 0) {
      previewCountHtml += `<span class="text-slate-400 font-normal text-xs ml-2">(มีข้อมูลครบแล้ว ${duplicateCount} รายการ - จะถูกข้าม)</span>`;
    }
    document.getElementById('import-preview-count').innerHTML = previewCountHtml;

    document.getElementById('import-preview-tbody').innerHTML = ordersToImport.slice(0, 15).map(o => `
      <tr class="border-b border-slate-100 text-xs">
        <td class="py-2 px-3 font-mono font-bold text-slate-800">
          <div class="flex items-center gap-1.5">
            ${o._type === 'BACKFILL' 
              ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">เติมวันที่</span>` 
              : `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">ใหม่</span>`}
            <span>${o.trackingId || '-'}</span>
          </div>
        </td>
        <td class="py-2 px-3 font-mono">${o.orderId}</td>
        <td class="py-2 px-3 font-medium">${o.sellerSku || '-'}</td>
        <td class="py-2 px-3 truncate max-w-xs">${o.productSummary || '-'}</td>
        <td class="py-2 px-3 text-center font-bold">${o.totalQuantity}</td>
        <td class="py-2 px-3">
          ${o.returnTime ? `
            <div class="font-medium text-slate-700">${o.returnTime}</div>
            <div class="text-[11px] text-blue-600 font-bold">ครบ: ${o.deadlineAt || '-'}</div>
          ` : `<span class="text-slate-400">-</span>`}
        </td>
      </tr>
    `).join('');

  } catch (err) {
    Swal.fire('ข้อผิดพลาด', err.message, 'error');
  }
}

async function uploadToGoogleSheets() {
  if (!AdminState.importedOrders || AdminState.importedOrders.length === 0) return;
  const orders = AdminState.importedOrders;

  Swal.fire({
    title: 'กำลังส่งข้อมูลเข้า Google Sheets...',
    text: `กำลังประมวลผล ${orders.length} ออเดอร์`,
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const chunkSize = 250;
  const totalChunks = Math.ceil(orders.length / chunkSize);
  let totalInserted = 0;
  let totalUpdatedDates = 0;
  let totalSkipped = 0;

  try {
    for (let i = 0; i < totalChunks; i++) {
      const chunk = orders.slice(i * chunkSize, (i + 1) * chunkSize);
      
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'bulkUpsertOrders',
          orders: chunk
        })
      });

      const text = await res.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch(e) {
        throw new Error('Google Apps Script ตอบกลับผิดพลาด: ' + text.slice(0, 100));
      }

      if (!result.success) throw new Error(result.error || 'การส่งข้อมูลขัดข้อง');
      totalInserted += (result.insertedCount || 0);
      totalUpdatedDates += (result.updatedDatesCount || 0);
      totalSkipped += (result.skippedCount || 0);
    }

    let summaryHtml = `<div class="text-left text-sm space-y-1.5 py-1">`;
    if (totalInserted > 0) {
      summaryHtml += `<p class="text-emerald-700 font-semibold">✅ เพิ่มรายการใหม่: <b>${totalInserted.toLocaleString()}</b> รายการ</p>`;
    }
    if (totalUpdatedDates > 0) {
      summaryHtml += `<p class="text-blue-700 font-semibold">🔄 เติมวันที่ย้อนหลัง: <b>${totalUpdatedDates.toLocaleString()}</b> รายการ</p>`;
    }
    if (totalSkipped > 0) {
      summaryHtml += `<p class="text-slate-400 text-xs">ข้ามข้อมูลที่มีครบแล้ว: ${totalSkipped.toLocaleString()} รายการ</p>`;
    }
    summaryHtml += `</div>`;

    Swal.fire({
      icon: 'success',
      title: 'นำเข้าข้อมูลสำเร็จ!',
      html: summaryHtml,
      confirmButtonText: 'ไปที่แดชบอร์ด',
      confirmButtonColor: '#2563EB'
    }).then(async () => {
      await fetchOrders(true);
      switchAdminTab('dashboard');
    });

  } catch (err) {
    Swal.fire('นำเข้าไม่สำเร็จ', err.message, 'error');
  }
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('admin-search-input');
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(applyFilters, 300);
    });
  }

  const cached = localStorage.getItem('admin_cached_orders');
  if (cached) {
    try {
      AdminState.orders = JSON.parse(cached);
      applyFilters();
    } catch(e) {}
  }

  refreshOrdersFromSheet(false);
});
