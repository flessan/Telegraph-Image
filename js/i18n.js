const STORAGE_KEY = 'ti.lang';
const SUPPORTED = ['en', 'id'];

const STRINGS = {
  en: {
    appName: 'Telegraph-Image',
    appTagline: 'Object workspace',
    skipToContent: 'Skip to files',
    searchPlaceholder: 'Search files',
    searchAria: 'Search files in this workspace',
    clearSearch: 'Clear search',
    navFiles: 'Files',
    navImages: 'Images',
    navRecent: 'Recent',
    navAria: 'Workspace views',
    breadcrumbRoot: 'Storage',
    addFiles: 'Add files',
    addFilesAria: 'Add files to the local workspace',
    pushChanges: 'Push changes',
    pushChangesAria: 'Send staged files to remote storage',
    pushing: 'Pushing…',
    refresh: 'Refresh',
    refreshAria: 'Refresh workspace and site status',
    themeLight: 'Light theme',
    themeDark: 'Dark theme',
    themeToggleAria: 'Switch color theme',
    language: 'Language',
    languageAria: 'Choose language',
    langEn: 'English',
    langId: 'Bahasa Indonesia',
    dashboard: 'Dashboard',
    dashboardAria: 'Open the management dashboard',
    github: 'GitHub',
    githubAria: 'Open the Telegraph-Image repository',
    moreActions: 'More actions',
    classicUploader: 'Classic uploader',
    viewGrid: 'Grid',
    viewList: 'List',
    viewGridAria: 'Show grid view',
    viewListAria: 'Show list view',
    sortBy: 'Sort',
    sortName: 'Name',
    sortDate: 'Date added',
    sortSize: 'Size',
    sortAsc: 'Ascending',
    sortDesc: 'Descending',
    colName: 'Name',
    colSize: 'Size',
    colType: 'Type',
    colStatus: 'Status',
    colAdded: 'Added',
    emptyFilesTitle: 'This workspace is empty',
    emptyFilesBody: 'Add files to review them here. Nothing is sent until you push changes.',
    emptyImagesTitle: 'No images yet',
    emptyImagesBody: 'Images you add or push will appear in this view.',
    emptyRecentTitle: 'Nothing recent',
    emptyRecentBody: 'Files added or pushed in this browser will show up here.',
    emptySearchTitle: 'No matching files',
    emptySearchBody: 'Try a different name. Search only looks at filenames in this workspace.',
    dropTitle: 'Drop files to add them',
    dropBody: 'They will stay on this device until you push changes.',
    pendingBanner: '{n} file waiting to be sent',
    pendingBannerPlural: '{n} files waiting to be sent',
    pendingHint: 'These files are only on this device.',
    discardPending: 'Remove pending',
    retryFailed: 'Retry failed',
    statusLocal: 'Local',
    statusPending: 'Pending',
    statusPushing: 'Pushing',
    statusSynced: 'Synced',
    statusFailed: 'Failed',
    locationLocal: 'On this device',
    locationRemote: 'Remote',
    sidebarHint: 'This browser keeps a local catalog. The public dashboard lists the full remote store when it is enabled.',
    stagingTitle: 'Ready to send',
    stagingEmpty: 'No pending changes',
    statusBarFiles: '{n} file',
    statusBarFilesPlural: '{n} files',
    statusBarPending: '{n} pending',
    statusBarFailed: '{n} failed',
    statusBarSynced: '{n} synced',
    linksTitle: 'Public links',
    linksHint: 'Copied from files already pushed in this workspace.',
    formatUrl: 'URL',
    formatMarkdown: 'Markdown',
    formatBbcode: 'BBCode',
    formatHtml: 'HTML',
    copyAll: 'Copy all',
    copyOne: 'Copy URL',
    copyOneAria: 'Copy public URL for {name}',
    copied: 'Copied to clipboard',
    copyFailed: 'Could not copy',
    download: 'Download',
    downloadAria: 'Download {name}',
    openPreview: 'Open',
    retry: 'Retry',
    remove: 'Remove',
    removeAria: 'Remove {name} from this workspace',
    cardMenuAria: 'Actions for {name}',
    previewTitle: 'File preview',
    previewClose: 'Close preview',
    metaFilename: 'Filename',
    metaDimensions: 'Dimensions',
    metaMime: 'MIME type',
    metaSize: 'Size',
    metaUrl: 'Public URL',
    metaStatus: 'Status',
    metaAdded: 'Added',
    metaPushed: 'Pushed',
    noPublicUrl: 'Not pushed yet — no public URL',
    unknownType: 'Unknown type',
    noDimensions: '—',
    confirmRemoveTitle: 'Remove from workspace?',
    confirmRemoveSynced: 'This only removes the item from this browser. The public file is not deleted.',
    confirmRemovePending: 'This file has not been sent. Removing it discards the local copy.',
    confirmRemove: 'Remove',
    cancel: 'Cancel',
    setupNeedsAttention: 'Needs attention',
    setupWarning: 'Warning',
    setupInfo: 'Note',
    uploadProtected: 'Uploads on this site require authentication. Push may fail until those credentials are provided by the host.',
    refreshed: 'Workspace refreshed',
    refreshFailed: 'Could not refresh site status',
    pushComplete: 'All staged files were sent',
    pushPartial: 'Some files could not be sent',
    pushNothing: 'Nothing to send',
    pushFailed: 'Could not send {name}',
    networkError: 'Network error',
    httpError: 'HTTP {status}',
    announceAdded: '{n} file added to the workspace',
    announceAddedPlural: '{n} files added to the workspace',
    announcePushing: 'Sending {current} of {total}',
    announcePushed: '{name} is now synced',
    announceFailed: '{name} failed to send',
    announceRemoved: '{name} removed from this workspace',
    fileCount: '{n} shown',
    selectFile: 'Select {name}',
    selectedCount: '{n} selected',
    copySelected: 'Copy selected URLs',
    fabAdd: 'Add files',
    closeMenu: 'Close menu',
    utilities: 'Workspace utilities',
    notAvailable: 'Not available',
    bytes: '{n} B',
    kb: '{n} KB',
    mb: '{n} MB',
    gb: '{n} GB',
    justNow: 'Just now',
    minutesAgo: '{n} min ago',
    hoursAgo: '{n} h ago',
    daysAgo: '{n} d ago',
  },
  id: {
    appName: 'Telegraph-Image',
    appTagline: 'Ruang kerja objek',
    skipToContent: 'Lompat ke berkas',
    searchPlaceholder: 'Cari berkas',
    searchAria: 'Cari berkas di ruang kerja ini',
    clearSearch: 'Hapus pencarian',
    navFiles: 'Berkas',
    navImages: 'Gambar',
    navRecent: 'Terbaru',
    navAria: 'Tampilan ruang kerja',
    breadcrumbRoot: 'Penyimpanan',
    addFiles: 'Tambah berkas',
    addFilesAria: 'Tambah berkas ke ruang kerja lokal',
    pushChanges: 'Kirim perubahan',
    pushChangesAria: 'Kirim berkas yang siap ke penyimpanan jarak jauh',
    pushing: 'Mengirim…',
    refresh: 'Muat ulang',
    refreshAria: 'Muat ulang ruang kerja dan status situs',
    themeLight: 'Tema terang',
    themeDark: 'Tema gelap',
    themeToggleAria: 'Ganti tema warna',
    language: 'Bahasa',
    languageAria: 'Pilih bahasa',
    langEn: 'English',
    langId: 'Bahasa Indonesia',
    dashboard: 'Dasbor',
    dashboardAria: 'Buka dasbor pengelolaan',
    github: 'GitHub',
    githubAria: 'Buka repositori Telegraph-Image',
    moreActions: 'Tindakan lain',
    classicUploader: 'Pengunggah klasik',
    viewGrid: 'Kisi',
    viewList: 'Daftar',
    viewGridAria: 'Tampilkan kisi',
    viewListAria: 'Tampilkan daftar',
    sortBy: 'Urutkan',
    sortName: 'Nama',
    sortDate: 'Tanggal ditambah',
    sortSize: 'Ukuran',
    sortAsc: 'Naik',
    sortDesc: 'Turun',
    colName: 'Nama',
    colSize: 'Ukuran',
    colType: 'Jenis',
    colStatus: 'Status',
    colAdded: 'Ditambah',
    emptyFilesTitle: 'Ruang kerja ini masih kosong',
    emptyFilesBody: 'Tambahkan berkas untuk meninjaunya di sini. Tidak ada yang dikirim sebelum Anda menekan kirim perubahan.',
    emptyImagesTitle: 'Belum ada gambar',
    emptyImagesBody: 'Gambar yang Anda tambahkan atau kirim akan muncul di tampilan ini.',
    emptyRecentTitle: 'Belum ada yang baru',
    emptyRecentBody: 'Berkas yang ditambahkan atau dikirim di peramban ini akan tampil di sini.',
    emptySearchTitle: 'Tidak ada berkas yang cocok',
    emptySearchBody: 'Coba nama lain. Pencarian hanya memeriksa nama berkas di ruang kerja ini.',
    dropTitle: 'Lepaskan berkas untuk menambahkannya',
    dropBody: 'Berkas tetap di perangkat ini sampai Anda mengirim perubahan.',
    pendingBanner: '{n} berkas menunggu dikirim',
    pendingBannerPlural: '{n} berkas menunggu dikirim',
    pendingHint: 'Berkas ini hanya ada di perangkat ini.',
    discardPending: 'Buang yang menunggu',
    retryFailed: 'Kirim ulang yang gagal',
    statusLocal: 'Lokal',
    statusPending: 'Menunggu',
    statusPushing: 'Mengirim',
    statusSynced: 'Tersimpan',
    statusFailed: 'Gagal',
    locationLocal: 'Di perangkat ini',
    locationRemote: 'Jarak jauh',
    sidebarHint: 'Peramban ini menyimpan katalog lokal. Dasbor publik menampilkan seluruh penyimpanan jarak jauh jika diaktifkan.',
    stagingTitle: 'Siap dikirim',
    stagingEmpty: 'Tidak ada perubahan menunggu',
    statusBarFiles: '{n} berkas',
    statusBarFilesPlural: '{n} berkas',
    statusBarPending: '{n} menunggu',
    statusBarFailed: '{n} gagal',
    statusBarSynced: '{n} tersimpan',
    linksTitle: 'Tautan publik',
    linksHint: 'Diambil dari berkas yang sudah dikirim di ruang kerja ini.',
    formatUrl: 'URL',
    formatMarkdown: 'Markdown',
    formatBbcode: 'BBCode',
    formatHtml: 'HTML',
    copyAll: 'Salin semua',
    copyOne: 'Salin tautan',
    copyOneAria: 'Salin tautan publik untuk {name}',
    copied: 'Disalin ke papan klip',
    copyFailed: 'Tidak dapat menyalin',
    download: 'Unduh',
    downloadAria: 'Unduh {name}',
    openPreview: 'Buka',
    retry: 'Coba lagi',
    remove: 'Buang',
    removeAria: 'Buang {name} dari ruang kerja ini',
    cardMenuAria: 'Tindakan untuk {name}',
    previewTitle: 'Pratinjau berkas',
    previewClose: 'Tutup pratinjau',
    metaFilename: 'Nama berkas',
    metaDimensions: 'Dimensi',
    metaMime: 'Jenis MIME',
    metaSize: 'Ukuran',
    metaUrl: 'Tautan publik',
    metaStatus: 'Status',
    metaAdded: 'Ditambahkan',
    metaPushed: 'Dikirim',
    noPublicUrl: 'Belum dikirim — belum ada tautan publik',
    unknownType: 'Jenis tidak diketahui',
    noDimensions: '—',
    confirmRemoveTitle: 'Buang dari ruang kerja?',
    confirmRemoveSynced: 'Ini hanya menghapus item dari peramban ini. Berkas publik tidak dihapus.',
    confirmRemovePending: 'Berkas ini belum dikirim. Membuangnya akan menghapus salinan lokal.',
    confirmRemove: 'Buang',
    cancel: 'Batal',
    setupNeedsAttention: 'Perlu ditindaklanjuti',
    setupWarning: 'Peringatan',
    setupInfo: 'Catatan',
    uploadProtected: 'Pengunggahan di situs ini memerlukan autentikasi. Pengiriman bisa gagal sampai kredensial disediakan oleh pengelola.',
    refreshed: 'Ruang kerja dimuat ulang',
    refreshFailed: 'Tidak dapat memuat status situs',
    pushComplete: 'Semua berkas siap telah dikirim',
    pushPartial: 'Beberapa berkas tidak dapat dikirim',
    pushNothing: 'Tidak ada yang perlu dikirim',
    pushFailed: 'Tidak dapat mengirim {name}',
    networkError: 'Kesalahan jaringan',
    httpError: 'HTTP {status}',
    announceAdded: '{n} berkas ditambahkan ke ruang kerja',
    announceAddedPlural: '{n} berkas ditambahkan ke ruang kerja',
    announcePushing: 'Mengirim {current} dari {total}',
    announcePushed: '{name} sekarang tersimpan',
    announceFailed: '{name} gagal dikirim',
    announceRemoved: '{name} dibuang dari ruang kerja ini',
    fileCount: '{n} ditampilkan',
    selectFile: 'Pilih {name}',
    selectedCount: '{n} dipilih',
    copySelected: 'Salin tautan terpilih',
    fabAdd: 'Tambah berkas',
    closeMenu: 'Tutup menu',
    utilities: 'Utilitas ruang kerja',
    notAvailable: 'Tidak tersedia',
    bytes: '{n} B',
    kb: '{n} KB',
    mb: '{n} MB',
    gb: '{n} GB',
    justNow: 'Baru saja',
    minutesAgo: '{n} mnt lalu',
    hoursAgo: '{n} jam lalu',
    daysAgo: '{n} hr lalu',
  },
};

let currentLang = 'en';
const listeners = new Set();

function normalizeLang(code) {
  if (!code) return null;
  const lower = String(code).toLowerCase();
  if (SUPPORTED.includes(lower)) return lower;
  const base = lower.split('-')[0];
  return SUPPORTED.includes(base) ? base : null;
}

export function detectLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const fromStore = normalizeLang(stored);
    if (fromStore) return fromStore;
  } catch (_) { /* private mode */ }

  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const candidates = (nav.languages && nav.languages.length ? nav.languages : [nav.language]).filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    const found = normalizeLang(candidates[i]);
    if (found) return found;
  }
  return 'en';
}

export function getLanguage() {
  return currentLang;
}

export function setLanguage(lang) {
  const next = normalizeLang(lang) || 'en';
  currentLang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* ignore */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
  }
  listeners.forEach((fn) => {
    try { fn(next); } catch (_) { /* listener errors should not break i18n */ }
  });
  return next;
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, vars) {
  const table = STRINGS[currentLang] || STRINGS.en;
  let value = table[key];
  if (value == null) value = STRINGS.en[key];
  if (value == null) value = key;
  if (vars) {
    value = String(value).replace(/\{(\w+)\}/g, (_, name) => (
      vars[name] == null ? '' : String(vars[name])
    ));
  }
  return value;
}

export function applyStaticI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}

export function initI18n() {
  setLanguage(detectLanguage());
  applyStaticI18n(document);
}

export const supportedLanguages = SUPPORTED.slice();
