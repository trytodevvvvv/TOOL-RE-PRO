const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
let asar = null;
try {
  asar = require('asar');
} catch (e) {
  console.log('Asar module not loaded yet');
}

const pythonDecompiler = require('./python_decompiler');

const app = express();
const PORT = process.env.PORT || 3399;

app.use(cors());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// File lưu cấu hình
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        colabUrl: '', // Mặc định xóa sạch sau mỗi lần tắt tool, không lưu URL cũ
        modelId: cfg.modelId || 'deepseek-r1-distill-qwen-14b',
        temperature: cfg.temperature || 0.6,
        maxTokens: cfg.maxTokens || 4096,
        recentProjects: cfg.recentProjects || []
      };
    }
  } catch (err) {
    console.error('Lỗi đọc config:', err);
  }
  return {
    colabUrl: '',
    modelId: 'deepseek-r1-distill-qwen-14b',
    temperature: 0.6,
    maxTokens: 4096,
    recentProjects: []
  };
}

function saveConfig(cfg) {
  try {
    const toSave = {
      // KHÔNG lưu colabUrl xuống ổ đĩa, để mỗi khi mở lại tool luôn mới tinh
      modelId: cfg.modelId || 'deepseek-r1-distill-qwen-14b',
      temperature: cfg.temperature || 0.6,
      maxTokens: cfg.maxTokens || 4096,
      recentProjects: cfg.recentProjects || []
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) {
    console.error('Lỗi lưu config:', err);
  }
}

function getRecentProjects() {
  const cfg = loadConfig();
  const list = cfg.recentProjects || [];
  return list.filter(p => fs.existsSync(p.path));
}

function addRecentProject(proj) {
  try {
    const cfg = loadConfig();
    let list = cfg.recentProjects || [];
    list = list.filter(p => path.resolve(p.path) !== path.resolve(proj.path));
    list.unshift({
      name: proj.name,
      path: proj.path,
      fileType: proj.fileType || 'Dự án đã bung',
      lastOpened: new Date().toISOString()
    });
    cfg.recentProjects = list.slice(0, 12);
    saveConfig(cfg);
  } catch (err) {
    console.error('Lỗi lưu recent project:', err);
  }
}

function removeRecentProject(projPath) {
  try {
    const cfg = loadConfig();
    let list = cfg.recentProjects || [];
    list = list.filter(p => path.resolve(p.path) !== path.resolve(projPath));
    cfg.recentProjects = list;
    saveConfig(cfg);
  } catch (err) {}
}

let currentConfig = loadConfig();

// Thư mục output mặc định cho các project bung mã nguồn
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'DECOMPILED_OUTPUT');
if (!fs.existsSync(DEFAULT_OUTPUT_DIR)) {
  fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
}

// 1. Kiểm tra trạng thái hệ thống
app.get('/api/status', (req, res) => {
  exec('npx.cmd -y rea-agents --version', { timeout: 10000 }, (error, stdout) => {
    const reaVersion = stdout ? stdout.trim() : (error ? 'Not Installed' : 'Ready');
    res.json({
      success: true,
      nodeVersion: process.version,
      platform: os.platform(),
      reaVersion: reaVersion,
      config: currentConfig
    });
  });
});

// 2. Test kết nối Colab
app.post('/api/colab/test', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Chưa cung cấp URL Cloudflare Colab' });
  }

  const cleanUrl = url.replace(/\/+$/, '').replace(/\/v1$/, '');
  const startTime = Date.now();

  try {
    const fetchFn = globalThis.fetch || (await import('node-fetch')).default;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const testUrl = `${cleanUrl}/v1/models`;
    const resp = await fetchFn(testUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} - ${resp.statusText}`);
    }

    const data = await resp.json();
    const latency = Date.now() - startTime;

    // Chỉ lưu tạm trong bộ nhớ RAM cho phiên chạy hiện tại, tắt tool là tự xóa sạch
    currentConfig.colabUrl = cleanUrl;

    // KÍCH HOẠT NẠP SẴN (WARM UP) MODEL VÀO TESLA T4 VRAM NGAY LẬP TỨC:
    fetchFn(`${cleanUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentConfig.modelId || 'deepseek-r1-distill-qwen-14b',
        messages: [{ role: 'user', content: 'Ping! Warm up GPU.' }],
        max_tokens: 1
      })
    }).then(() => {
      console.log(`[COLAB] Đã nạp thành công DeepSeek-R1 vào GPU VRAM (Tesla T4)!`);
    }).catch(e => console.log('[COLAB] Warm-up notice:', e.message));

    res.json({
      success: true,
      latencyMs: latency,
      models: data.data || [{ id: 'deepseek-r1-distill-qwen-14b' }],
      cleanUrl: cleanUrl
    });
  } catch (err) {
    res.json({
      success: false,
      error: err.name === 'AbortError' ? 'Hết thời gian chờ kết nối (Timeout 12s)' : err.message
    });
  }
});

// Hàm tìm tất cả file .asar đệ quy trong thư mục
function findAsarFiles(dir, fileList = [], depth = 0) {
  if (depth > 6) return fileList;
  try {
    const list = fs.readdirSync(dir);
    for (const item of list) {
      const full = path.join(dir, item);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (item !== 'node_modules' && !item.startsWith('.')) {
            findAsarFiles(full, fileList, depth + 1);
          }
        } else if (item.endsWith('.asar')) {
          fileList.push(full);
        }
      } catch (e) {}
    }
  } catch (e) {}
  return fileList;
}

// Sao chép toàn bộ thư mục đệ quy
function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    try {
      const stat = fs.statSync(curSource);
      if (stat.isDirectory()) {
        copyFolderRecursiveSync(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
      }
    } catch (e) {}
  }
}

// Tạo liên kết Junction (Windows mklink /J) tức thời, tiết kiệm ổ đĩa, nếu lỗi thì copy
function createJunctionOrCopy(source, target) {
  if (fs.existsSync(target)) return;
  const parent = path.dirname(target);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  try {
    const { execSync } = require('child_process');
    execSync(`cmd.exe /c mklink /J "${target}" "${source}"`);
    console.log(`[LINK] Đã liên kết thư mục phụ trợ: ${target} -> ${source}`);
  } catch (err) {
    console.log(`[COPY] Liên kết junction không hỗ trợ, sao chép thư mục: ${source}`);
    copyFolderRecursiveSync(source, target);
  }
}

// Đếm tổng số tệp mã nguồn trong thư mục
function countFilesInDir(dir, depth = 0) {
  let count = 0;
  if (depth > 8) return count;
  try {
    const list = fs.readdirSync(dir);
    for (const item of list) {
      const full = path.join(dir, item);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          count += countFilesInDir(full, depth + 1);
        } else {
          count++;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return count;
}

// Hàm hỗ trợ quét cây thư mục mã nguồn (Ưu tiên hiển thị file dự án quan trọng lên đầu)
function getDirectoryTree(dirPath, maxFiles = 250, depth = 0) {
  let results = [];
  try {
    if (!fs.existsSync(dirPath)) return results;
    let list = fs.readdirSync(dirPath);

    // Sắp xếp ưu tiên: mã nguồn chính lên đầu, file chạy lên đầu, thư mục phụ trợ nặng xuống cuối
    list.sort((a, b) => {
      if (a === 'resources') return -1;
      if (b === 'resources') return 1;
      if (a === 'app') return -1;
      if (b === 'app') return 1;
      if (a.toLowerCase().startsWith('run_app')) return -1;
      if (b.toLowerCase().startsWith('run_app')) return 1;
      if (a === 'package.json') return -1;
      if (b === 'package.json') return 1;
      if (a === 'dist' || a === 'src') return -1;
      if (b === 'dist' || b === 'src') return 1;
      if (a === 'node_modules' || a === 'locales' || a === 'bin') return 1;
      if (b === 'node_modules' || b === 'locales' || b === 'bin') return -1;
      return a.localeCompare(b);
    });

    for (const item of list) {
      if (results.length >= maxFiles) break;
      const fullPath = path.join(dirPath, item);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          let childLimit = 50;
          if (item === 'node_modules') childLimit = 8;
          else if (item === 'locales') childLimit = 3;
          else if (item === 'bin' && fullPath.includes('resources')) childLimit = 4;
          else if (item === 'app') childLimit = 250; // Ưu tiên tối đa cho thư mục mã nguồn app!

          results.push({
            name: item,
            path: fullPath,
            isDir: true,
            children: depth < 6 ? getDirectoryTree(fullPath, childLimit, depth + 1) : []
          });
        } else {
          results.push({ name: item, path: fullPath, isDir: false, size: stat.size });
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error('Lỗi quét tree:', e);
  }
  return results;
}

// 3. TỰ ĐỘNG DỊCH NGƯỢC & BUNG TOÀN BỘ MÃ NGUỒN RA THƯ MỤC
app.post('/api/project/auto-decompile', async (req, res) => {
  const { targetPath, customOutputDir } = req.body;

  if (!targetPath || !fs.existsSync(targetPath)) {
    return res.status(400).json({ success: false, error: 'Đường dẫn tệp/thư mục không tồn tại trên máy!' });
  }

  const stats = fs.statSync(targetPath);
  const isDirectory = stats.isDirectory();
  const ext = path.extname(targetPath).toLowerCase();
  const baseName = path.basename(targetPath, ext);

  // Tạo thư mục bung mã nguồn riêng biệt cho tệp này
  const targetOutputDir = customOutputDir || path.join(DEFAULT_OUTPUT_DIR, `${baseName}_Decompiled`);
  if (!fs.existsSync(targetOutputDir)) {
    fs.mkdirSync(targetOutputDir, { recursive: true });
  }

  console.log(`[DECOMPILE] Mục tiêu: ${targetPath}`);
  console.log(`[DECOMPILE] Thư mục bung source code: ${targetOutputDir}`);

  let fileType = 'Unknown';
  let primaryOutputText = '';
  let mainScriptPath = null;

  try {
    // TRƯỜNG HỢP 1: Tệp lẻ Electron ASAR (.asar) -> BUNG TOÀN BỘ 100% FILE GỐC
    if (ext === '.asar') {
      fileType = 'Electron Archive (.asar)';
      if (asar) {
        asar.extractAll(targetPath, targetOutputDir);
        primaryOutputText = `[THÀNH CÔNG] Đã giải nén toàn bộ archive ASAR vào thư mục:\n${targetOutputDir}`;
      } else {
        execSync(`npx.cmd -y asar extract "${targetPath}" "${targetOutputDir}"`);
        primaryOutputText = `[THÀNH CÔNG] Đang giải nén ASAR bằng công cụ asar...`;
      }
    }
    // TRƯỜNG HỢP 2: Thư mục dự án / Ứng dụng Desktop Electron / JavaScript / Python
    else if (isDirectory) {
      // Quét tìm file archive ASAR trong ứng dụng
      const foundAsars = findAsarFiles(targetPath);
      console.log(`[DECOMPILE] Tìm thấy ${foundAsars.length} file archive ASAR trong ứng dụng:`, foundAsars);

      const rootItems = fs.readdirSync(targetPath);
      const rootExe = rootItems.find(f => f.toLowerCase().endsWith('.exe') && !f.toLowerCase().includes('uninstall') && f.toLowerCase() !== 'elevate.exe') || rootItems.find(f => f.toLowerCase().endsWith('.exe'));

      // KIỂM TRA XEM ĐÂY CÓ PHẢI LÀ ỨNG DỤNG ELECTRON ĐÓNG GÓI HOÀN CHỈNH KHÔNG
      const isElectronApp = foundAsars.length > 0 && (
        rootExe || 
        rootItems.includes('resources') || 
        rootItems.includes('icudtl.dat') || 
        rootItems.includes('resources.pak')
      );

      if (isElectronApp) {
        fileType = 'Ứng dụng Desktop (Electron Live Unpack)';
        console.log(`[DECOMPILE] 🚀 PHÁT HIỆN ỨNG DỤNG ELECTRON HOÀN CHỈNH! Tiến hành FULL CLONE RUNTIME & LIVE UNPACK...`);

        // 1. CLONE TOÀN BỘ CẤU TRÚC RUNTIME (EXE, DLL, PAK, ICU, LOCALES, BIN) VÀO TARGET
        for (const item of rootItems) {
          const itemSrc = path.join(targetPath, item);
          const itemDst = path.join(targetOutputDir, item);
          try {
            const stat = fs.statSync(itemSrc);
            if (stat.isDirectory()) {
              if (item === 'locales') {
                copyFolderRecursiveSync(itemSrc, itemDst);
                console.log(`[DECOMPILE] Đã copy locales/`);
              } else if (item === 'resources') {
                if (!fs.existsSync(itemDst)) fs.mkdirSync(itemDst, { recursive: true });
                // Copy các file non-asar trong resources (như elevate.exe)
                const resItems = fs.readdirSync(itemSrc);
                for (const rf of resItems) {
                  const rfSrc = path.join(itemSrc, rf);
                  const rfDst = path.join(itemDst, rf);
                  const rfStat = fs.statSync(rfSrc);
                  if (!rfStat.isDirectory() && !rf.endsWith('.asar')) {
                    fs.copyFileSync(rfSrc, rfDst);
                  }
                }
                // Nếu resources/bin có Chromium hoặc FFmpeg thì tạo Junction cực nhanh
                const binSrc = path.join(itemSrc, 'bin');
                const binDst = path.join(itemDst, 'bin');
                if (fs.existsSync(binSrc)) {
                  createJunctionOrCopy(binSrc, binDst);
                }
              } else {
                copyFolderRecursiveSync(itemSrc, itemDst);
              }
            } else {
              // Copy toàn bộ file gốc: *.exe, *.dll, *.pak, icudtl.dat, *.bin,...
              fs.copyFileSync(itemSrc, itemDst);
            }
          } catch (e) {
            console.warn(`Lỗi sao chép item ${item}:`, e.message);
          }
        }

        // 2. GIẢI NÉN TOÀN BỘ MÃ NGUỒN ASAR TRỰC TIẾP VÀO resources/app
        const appExtractDir = path.join(targetOutputDir, 'resources', 'app');
        if (!fs.existsSync(appExtractDir)) {
          fs.mkdirSync(appExtractDir, { recursive: true });
        }

        for (const asarPath of foundAsars) {
          console.log(`[DECOMPILE] Đang bung toàn bộ mã nguồn ẩn từ: ${asarPath} -> ${appExtractDir}`);
          try {
            if (asar) {
              asar.extractAll(asarPath, appExtractDir);
            } else {
              execSync(`npx.cmd -y asar extract "${asarPath}" "${appExtractDir}"`);
            }
          } catch (e) {
            console.error('Lỗi asar extract:', e.message);
          }

          // Kiểm tra và copy thư mục .unpacked nếu có (native module C++ .node)
          const unpackedDir = asarPath + '.unpacked';
          if (fs.existsSync(unpackedDir)) {
            const destUnpacked = path.join(targetOutputDir, 'resources', path.basename(unpackedDir));
            createJunctionOrCopy(unpackedDir, destUnpacked);
          }

          // Sao lưu file ASAR gốc thành app.asar.bak (để luôn có bản gốc đối chiếu)
          const backupAsarPath = path.join(targetOutputDir, 'resources', 'app.asar.bak');
          if (!fs.existsSync(backupAsarPath)) {
            try {
              fs.copyFileSync(asarPath, backupAsarPath);
            } catch (e) {}
          }

          // Đảm bảo có file app.asar ban đầu đã đồng bộ để chạy
          const liveAsarPath = path.join(targetOutputDir, 'resources', 'app.asar');
          if (!fs.existsSync(liveAsarPath)) {
            try {
              fs.copyFileSync(asarPath, liveAsarPath);
            } catch (e) {}
          }
        }

        // 3. XÁC ĐỊNH SCRIPT CHÍNH TRONG resources/app (main.js)
        const pkgPath = path.join(appExtractDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.main) {
              const candidate = path.join(appExtractDir, pkg.main);
              if (fs.existsSync(candidate)) mainScriptPath = candidate;
            }
          } catch (e) {}
        }
        if (!mainScriptPath) {
          if (fs.existsSync(path.join(appExtractDir, 'dist', 'main.js'))) {
            mainScriptPath = path.join(appExtractDir, 'dist', 'main.js');
          } else if (fs.existsSync(path.join(appExtractDir, 'main.js'))) {
            mainScriptPath = path.join(appExtractDir, 'main.js');
          } else if (fs.existsSync(pkgPath)) {
            mainScriptPath = pkgPath;
          }
        }

        // 4. TẠO SẴN FILE RUN_APP.bat VÀ BUILD_NEW_EXE.bat CHUẨN NATIVE
        const primaryExeName = rootExe || (rootItems.find(f => f.toLowerCase().endsWith('.exe')) || `${baseName}.exe`);
        try {
          const runBatContent = `@echo off\r\ntitle REA Studio - Running Decompiled Live App\r\ncolor 0a\r\necho ================================================================\r\necho   DANG KHOI CHAY UNG DUNG TRUC TIEP TU MA NGUON VUA BUNG...\r\necho   (Moi thay doi code trong REA Studio deu co hieu luc ngay!)\r\necho ================================================================\r\ncd /d "%~dp0"\r\nstart "" "%~dp0${primaryExeName}"\r\n`;
          fs.writeFileSync(path.join(targetOutputDir, 'RUN_APP.bat'), runBatContent, 'utf8');

          const buildBatContent = `@echo off\r\ntitle REA Studio - Build / Repack ASAR\r\ncolor 0b\r\necho ================================================================\r\necho   DANG DONG GOI LAI THU MUC resources\\app THANH FILE app.asar...\r\necho ================================================================\r\ncd /d "%~dp0"\r\nnpx.cmd -y asar pack "resources\\app" "resources\\app.asar"\r\necho.\r\necho [OK] Da dong goi thanh cong resources\\app.asar!\r\npause\r\n`;
          fs.writeFileSync(path.join(targetOutputDir, 'BUILD_NEW_EXE.bat'), buildBatContent, 'utf8');
        } catch (e) {}

        // 5. CHẠY REA ANALYZE TRÊN THƯ MỤC SOURCE CODE BUNG RA
        const runReaRecover = () => new Promise((resolve) => {
          exec(`npx.cmd -y rea-agents@6.5.0 analyze-javascript-application "${appExtractDir}" --format json`, {
            maxBuffer: 1024 * 1024 * 35,
            timeout: 70000
          }, (err, stdout, stderr) => {
            resolve(stdout || stderr || '');
          });
        });

        primaryOutputText = await runReaRecover();
        fs.writeFileSync(path.join(targetOutputDir, 'electron_analysis_evidence.json'), primaryOutputText, 'utf8');

      } else {
        // DỰ ÁN ELECTRON THƯỜNG / JAVASCRIPT / PYTHON CƠ BẢN
        if (foundAsars.length > 0) {
          for (const asarPath of foundAsars) {
            console.log(`[DECOMPILE] Đang bung archive mã nguồn: ${asarPath}`);
            try {
              if (asar) {
                asar.extractAll(asarPath, targetOutputDir);
              } else {
                execSync(`npx.cmd -y asar extract "${asarPath}" "${targetOutputDir}"`);
              }
            } catch (e) {
              console.error('Lỗi asar extract:', e.message);
            }
          }
        }

        // Tự động sao chép file EXE gốc (nếu có)
        try {
          for (const rf of rootItems) {
            if (rf.toLowerCase().endsWith('.exe')) {
              const exeSource = path.join(targetPath, rf);
              const exeBackupDir = path.join(targetOutputDir, 'original_executable');
              if (!fs.existsSync(exeBackupDir)) fs.mkdirSync(exeBackupDir, { recursive: true });
              fs.copyFileSync(exeSource, path.join(exeBackupDir, rf));
            }
          }
        } catch (e) {}

        // Tự động dịch ngược các tệp .pyc nếu có trong thư mục
        try {
          await pythonDecompiler.decompileAllPycFiles(targetOutputDir);
        } catch (e) {}

        // Tạo sẵn file RUN_APP.bat và BUILD_NEW_EXE.bat
        try {
          const runBatContent = `@echo off\r\ntitle REA Studio - Running Decompiled App\r\ncolor 0a\r\necho ================================================================\r\necho   DANG KHOI CHAY UNG DUNG TRUC TIEP TU MA NGUON VUA BUNG RA...\r\necho ================================================================\r\nnpx.cmd -y electron .\r\npause\r\n`;
          fs.writeFileSync(path.join(targetOutputDir, 'RUN_APP.bat'), runBatContent, 'utf8');

          const buildBatContent = `@echo off\r\ntitle REA Studio - Build Decompiled Project to EXE\r\ncolor 0b\r\necho ================================================================\r\necho   DANG DONG GOI MA NGUON THANH FILE EXE MOI (ELECTRON-BUILDER)...\r\necho ================================================================\r\nnpx.cmd -y electron-builder --dir\r\npause\r\n`;
          fs.writeFileSync(path.join(targetOutputDir, 'BUILD_NEW_EXE.bat'), buildBatContent, 'utf8');
        } catch (e) {}

        const runReaRecover = () => new Promise((resolve) => {
          exec(`npx.cmd -y rea-agents@6.5.0 analyze-javascript-application "${targetPath}" --format json`, {
            maxBuffer: 1024 * 1024 * 35,
            timeout: 70000
          }, (err, stdout, stderr) => {
            resolve(stdout || stderr || '');
          });
        });

        primaryOutputText = await runReaRecover();
        fs.writeFileSync(path.join(targetOutputDir, 'electron_analysis_evidence.json'), primaryOutputText, 'utf8');
      }
    }
    // TRƯỜNG HỢP 3: Tệp mã nguồn đơn lẻ JavaScript (.js, .ts)
    else if (ext === '.js' || ext === '.ts') {
      fileType = 'Tệp mã nguồn JavaScript';
      const destFile = path.join(targetOutputDir, path.basename(targetPath));
      fs.copyFileSync(targetPath, destFile);
      mainScriptPath = destFile;

      const runReaRecover = () => new Promise((resolve) => {
        exec(`npx.cmd -y rea-agents@6.5.0 analyze-javascript-application "${targetPath}" --format json`, {
          maxBuffer: 1024 * 1024 * 30,
          timeout: 60000
        }, (err, stdout, stderr) => {
          resolve(stdout || stderr || '');
        });
      });
      primaryOutputText = await runReaRecover();
      fs.writeFileSync(path.join(targetOutputDir, 'analysis_evidence.json'), primaryOutputText, 'utf8');
    }
    // TRƯỜNG HỢP 4: Tệp thực thi EXE -> Tự động nhận diện PyInstaller (Python) hoặc Native Binary
    else if (ext === '.exe') {
      console.log(`[DECOMPILE] Đang kiểm tra cấu trúc file EXE: ${targetPath}`);
      const pyCheck = await pythonDecompiler.checkIsPyInstaller(targetPath);

      if (pyCheck.isPyInstaller) {
        fileType = `Ứng dụng Python (PyInstaller - Python ${pyCheck.pythonVersion})`;
        console.log(`[DECOMPILE] 🐍 PHÁT HIỆN TOOL PYTHON (PyInstaller)! Bắt đầu bung toàn bộ mã nguồn...`);

        // 1. Bung archive PyInstaller
        const extractRes = await pythonDecompiler.extractPyInstallerArchive(targetPath, targetOutputDir);

        // 2. Dịch ngược tất cả các file .pyc sang .py
        console.log(`[DECOMPILE] Đang dịch ngược toàn bộ file bytecode .pyc sang .py...`);
        await pythonDecompiler.decompileAllPycFiles(targetOutputDir);

        // 3. Sao lưu file EXE gốc
        try {
          const exeBackupDir = path.join(targetOutputDir, 'original_executable');
          if (!fs.existsSync(exeBackupDir)) fs.mkdirSync(exeBackupDir, { recursive: true });
          fs.copyFileSync(targetPath, path.join(exeBackupDir, path.basename(targetPath)));
        } catch (e) {}

        // 4. Xác định entry point chính
        let mainScript = extractRes.mainEntry ? extractRes.mainEntry.replace(/\.pyc$/, '.py') : `${baseName}.py`;
        let mainPyPath = path.join(targetOutputDir, mainScript);

        if (!fs.existsSync(mainPyPath)) {
          const pyFiles = fs.readdirSync(targetOutputDir).filter(f => f.endsWith('.py'));
          if (pyFiles.length > 0) {
            mainScript = pyFiles[0];
            mainPyPath = path.join(targetOutputDir, mainScript);
          }
        }

        if (fs.existsSync(mainPyPath)) {
          mainScriptPath = mainPyPath;
        }

        // 5. Tạo file RUN_APP.bat và BUILD_NEW_EXE.bat cho Python
        pythonDecompiler.generatePythonRunnerScripts(targetOutputDir, mainScript);

        // 6. Đọc nội dung mã nguồn chính và disassembly
        let mainScriptContent = '';
        if (mainScriptPath && fs.existsSync(mainScriptPath)) {
          mainScriptContent = fs.readFileSync(mainScriptPath, 'utf8');
        }

        const disasmPath = path.join(targetOutputDir, `${path.basename(mainScript, '.py')}_disasm.txt`);
        let disasmContent = '';
        if (fs.existsSync(disasmPath)) {
          disasmContent = fs.readFileSync(disasmPath, 'utf8').slice(0, 10000);
        }

        primaryOutputText = `[THÀNH CÔNG] ĐÃ BUNG TOÀN BỘ ỨNG DỤNG PYTHON (PYINSTALLER EXECUTABLE)
- Phiên bản Python: ${pyCheck.pythonVersion}
- Điểm khởi chạy chính: ${mainScript}
- Thư mục lưu mã nguồn: ${targetOutputDir}
- File chạy ứng dụng: RUN_APP.bat (nhấp đúp để chạy ngay với Python)
- File đóng gói lại: BUILD_NEW_EXE.bat (nhấp đúp để build lại file EXE)

================================================================================
MÃ NGUỒN PYTHON DỊCH NGƯỢC (${mainScript}):
================================================================================
${mainScriptContent || '// Đã trích xuất bytecode và disassembly bên dưới.'}

================================================================================
DISASSEMBLY BYTECODE & OPCODE ANALYSIS (${mainScript}):
================================================================================
${disasmContent.slice(0, 5000)}
`;
        fs.writeFileSync(path.join(targetOutputDir, 'python_decompile_report.txt'), primaryOutputText, 'utf8');

      } else {
        // Tệp EXE Native (C/C++, Go, Rust, Delphi,...)
        fileType = `Native Binary (${ext.toUpperCase() || 'Executable'})`;

        const runReaStrings = () => new Promise((resolve) => {
          exec(`npx.cmd -y rea-agents@6.5.0 strings "${targetPath}" --format json`, {
            maxBuffer: 1024 * 1024 * 30,
            timeout: 60000
          }, (err, stdout, stderr) => {
            resolve(stdout || stderr || '');
          });
        });

        primaryOutputText = await runReaStrings();

        fs.writeFileSync(path.join(targetOutputDir, 'decompiled_strings.txt'), primaryOutputText, 'utf8');
        fs.writeFileSync(path.join(targetOutputDir, 'binary_meta.json'), JSON.stringify({
          fileName: path.basename(targetPath),
          sizeBytes: stats.size,
          fileType: fileType,
          timestamp: new Date().toISOString()
        }, null, 2), 'utf8');
      }
    }
    // TRƯỜNG HỢP 5: Tệp Bytecode Python đơn lẻ (.pyc)
    else if (ext === '.pyc') {
      fileType = 'Python Bytecode (.pyc)';
      const targetPyc = path.join(targetOutputDir, path.basename(targetPath));
      fs.copyFileSync(targetPath, targetPyc);

      const decRes = await pythonDecompiler.decompileSinglePyc(targetPyc);
      if (decRes.pyPath) {
        mainScriptPath = decRes.pyPath;
      }
      pythonDecompiler.generatePythonRunnerScripts(targetOutputDir, path.basename(targetPath, '.pyc') + '.py');

      primaryOutputText = `[THÀNH CÔNG] ĐÃ DỊCH NGƯỢC TỆP PYTHON BYTECODE (.PYC)
- Tệp gốc: ${path.basename(targetPath)}
- File mã nguồn: ${decRes.pyPath ? path.basename(decRes.pyPath) : 'Chưa dịch ngược hoàn chỉnh'}

================================================================================
MÃ NGUỒN PYTHON DỊCH NGƯỢC:
================================================================================
${decRes.pyCode || '// Chưa trích xuất được text mã nguồn trực tiếp.'}

================================================================================
OPCODE DISASSEMBLY:
================================================================================
${(decRes.disasm || '').slice(0, 5000)}
`;
      fs.writeFileSync(path.join(targetOutputDir, 'python_decompile_report.txt'), primaryOutputText, 'utf8');
    }
    // TRƯỜNG HỢP 6: Tệp mã nguồn Python đơn lẻ (.py)
    else if (ext === '.py') {
      fileType = 'Mã nguồn Python (.py)';
      const targetPy = path.join(targetOutputDir, path.basename(targetPath));
      fs.copyFileSync(targetPath, targetPy);
      mainScriptPath = targetPy;
      pythonDecompiler.generatePythonRunnerScripts(targetOutputDir, path.basename(targetPath));
      primaryOutputText = fs.readFileSync(targetPath, 'utf8');
    }
    // TRƯỜNG HỢP 7: Các tệp nhị phân khác (DLL, SO, BIN, APK, ...)
    else {
      fileType = `Binary / Data (${ext.toUpperCase() || 'Unknown'})`;
      const runReaStrings = () => new Promise((resolve) => {
        exec(`npx.cmd -y rea-agents@6.5.0 strings "${targetPath}" --format json`, {
          maxBuffer: 1024 * 1024 * 30,
          timeout: 60000
        }, (err, stdout, stderr) => {
          resolve(stdout || stderr || '');
        });
      });

      primaryOutputText = await runReaStrings();
      fs.writeFileSync(path.join(targetOutputDir, 'decompiled_strings.txt'), primaryOutputText, 'utf8');
    }

    // Đếm tổng số file đã bung ra
    const totalExtractedFiles = countFilesInDir(targetOutputDir);
    const extractedTree = getDirectoryTree(targetOutputDir);

    // Tự động lưu vào danh sách Dự Án Gần Đây (Recent Projects)
    addRecentProject({
      name: path.basename(targetPath),
      path: targetOutputDir,
      fileType
    });

    res.json({
      success: true,
      fileInfo: {
        name: path.basename(targetPath),
        fullPath: targetPath,
        size: stats.size,
        isDirectory,
        fileType
      },
      totalExtractedFiles,
      outputDir: targetOutputDir,
      mainScriptPath,
      primaryOutputText: primaryOutputText.slice(0, 100000),
      extractedTree
    });

  } catch (err) {
    console.error('Lỗi decompile:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.1 API Đọc nội dung file mã nguồn vừa bung để hiển thị lên Code Viewer
app.post('/api/project/read-file', (req, res) => {
  const { filePath } = req.body;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'Tệp không tồn tại' });
  }
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024 * 5) {
      return res.json({ success: true, content: `// [THÔNG BÁO] Tệp quá lớn (${(stat.size / 1024 / 1024).toFixed(2)} MB), hãy mở trong Explorer.` });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.2 API Lưu đè nội dung file mã nguồn sau khi chỉnh sửa trực tiếp (DnSpy Style Save)
app.post('/api/project/save-file', (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ success: false, error: 'Thiếu đường dẫn hoặc nội dung tệp' });
  }
  try {
    // Đảm bảo thư mục cha tồn tại
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[SAVE] Đã lưu thành công tệp: ${filePath}`);

    // TỰ ĐỘNG ĐỒNG BỘ MÃ NGUỒN VÀO app.asar TRONG NỀN NẾU TỆP NẰM TRONG resources/app
    let syncedAsar = false;
    const normalized = filePath.replace(/\\/g, '/');
    const appIdx = normalized.indexOf('/resources/app/');
    if (appIdx !== -1 && asar && typeof asar.createPackage === 'function') {
      const projectRoot = filePath.substring(0, appIdx);
      const appDir = path.join(projectRoot, 'resources', 'app');
      const targetAsar = path.join(projectRoot, 'resources', 'app.asar');
      // Đồng bộ bất đồng bộ trong nền (<850ms), không làm chậm phản hồi UI
      asar.createPackage(appDir, targetAsar).then(() => {
        console.log(`[AUTO-SYNC] Đã đồng bộ tức thì ${path.basename(filePath)} vào ${targetAsar}`);
      }).catch(err => {
        console.warn('[AUTO-SYNC] Cảnh báo đồng bộ asar:', err.message);
      });
      syncedAsar = true;
    }

    res.json({ 
      success: true, 
      savedPath: filePath, 
      size: Buffer.byteLength(content, 'utf8'),
      syncedAsar 
    });
  } catch (err) {
    console.error('Lỗi lưu tệp:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.3 API Đóng gói lại mã nguồn thành ASAR (DnSpy "Save Module..." Style Re-pack)
app.post('/api/project/repack-asar', async (req, res) => {
  const { sourceDir, outputAsarPath } = req.body;
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return res.status(400).json({ success: false, error: 'Thư mục mã nguồn không tồn tại!' });
  }

  // Tự động nhận diện nếu dự án theo chuẩn Live Unpack (mã nguồn nằm trong resources/app)
  let actualSourceDir = sourceDir;
  const liveAppDir = path.join(sourceDir, 'resources', 'app');
  if (fs.existsSync(liveAppDir)) {
    actualSourceDir = liveAppDir;
  }

  const baseName = path.basename(sourceDir);
  // Đảm bảo targetAsar nằm trong một thư mục hợp lệ
  let targetAsar = outputAsarPath;
  if (!targetAsar) {
    if (fs.existsSync(path.join(sourceDir, 'resources'))) {
      targetAsar = path.join(sourceDir, 'resources', 'app.asar');
    } else {
      targetAsar = path.join(sourceDir, `${baseName}_Patched.asar`);
    }
  }

  console.log(`[REPACK] Bắt đầu đóng gói lại ASAR từ: ${actualSourceDir}`);
  console.log(`[REPACK] File ASAR xuất ra: ${targetAsar}`);

  try {
    const targetDir = path.dirname(targetAsar);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Tự động bỏ qua original_executable (240MB), .bat, .asar, và evidence để file asar sạch và nhẹ nhất
    const repackOptions = {
      globOptions: {
        ignore: [
          '**/original_executable/**',
          '**/*.bat',
          '**/*.cmd',
          '**/*.asar',
          '**/*.bak',
          '**/electron_analysis_evidence.json'
        ]
      }
    };

    if (asar && typeof asar.createPackageWithOptions === 'function') {
      await asar.createPackageWithOptions(actualSourceDir, targetAsar, repackOptions);
    } else if (asar && typeof asar.createPackage === 'function') {
      await asar.createPackage(actualSourceDir, targetAsar);
    } else {
      execSync(`npx.cmd -y asar pack "${actualSourceDir}" "${targetAsar}"`);
    }

    const stat = fs.statSync(targetAsar);
    res.json({
      success: true,
      asarPath: targetAsar,
      sizeBytes: stat.size,
      message: `Đã đóng gói thành công file ASAR đã chỉnh sửa:\n${targetAsar}`
    });
  } catch (err) {
    console.error('Lỗi đóng gói ASAR:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.4 API Mở thư mục dự án đã bung trước đó (KHÔNG DECOMPILE LẠI, NẠP TRONG 0.2 GIÂY)
app.post('/api/project/open-existing', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || !fs.existsSync(folderPath)) {
    return res.status(400).json({ success: false, error: 'Thư mục dự án không tồn tại trên máy tính!' });
  }

  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) {
    return res.status(400).json({ success: false, error: 'Đường dẫn phải là một thư mục!' });
  }

  try {
    const baseName = path.basename(folderPath);
    let fileType = 'Dự án đã bung';
    let mainScriptPath = null;

    // Tự động nhận diện loại dự án từ nội dung thư mục
    const items = fs.readdirSync(folderPath);
    const hasLiveApp = fs.existsSync(path.join(folderPath, 'resources', 'app'));

    if (hasLiveApp) {
      fileType = 'Ứng dụng Desktop (Electron Live Unpack)';
      const appDir = path.join(folderPath, 'resources', 'app');
      const pkgPath = path.join(appDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.main && fs.existsSync(path.join(appDir, pkg.main))) {
            mainScriptPath = path.join(appDir, pkg.main);
          }
        } catch (e) {}
      }
      if (!mainScriptPath) {
        if (fs.existsSync(path.join(appDir, 'dist', 'main.js'))) {
          mainScriptPath = path.join(appDir, 'dist', 'main.js');
        } else if (fs.existsSync(path.join(appDir, 'main.js'))) {
          mainScriptPath = path.join(appDir, 'main.js');
        } else if (fs.existsSync(pkgPath)) {
          mainScriptPath = pkgPath;
        }
      }
    } else if (items.includes('package.json') || (items.includes('RUN_APP.bat') && fs.existsSync(path.join(folderPath, 'dist')))) {
      fileType = 'Ứng dụng Desktop (Electron / Node.js)';
      if (fs.existsSync(path.join(folderPath, 'dist', 'main.js'))) {
        mainScriptPath = path.join(folderPath, 'dist', 'main.js');
      } else if (fs.existsSync(path.join(folderPath, 'package.json'))) {
        mainScriptPath = path.join(folderPath, 'package.json');
      }
    } else if (items.some(f => f.endsWith('.py')) || items.some(f => f.endsWith('.pyc'))) {
      fileType = 'Ứng dụng Python';
      const pyFiles = items.filter(f => f.endsWith('.py') && !f.startsWith('pyi'));
      if (pyFiles.length > 0) {
        mainScriptPath = path.join(folderPath, pyFiles[0]);
      }
    }

    const totalExtractedFiles = countFilesInDir(folderPath);
    const extractedTree = getDirectoryTree(folderPath);

    // Lưu vào danh sách Dự Án Gần Đây
    addRecentProject({
      name: baseName,
      path: folderPath,
      fileType
    });

    let primaryOutputText = `// =========================================================================\n// [DỰ ÁN ĐÃ BUNG]: ${baseName}\n// Đường dẫn: ${folderPath}\n// Định dạng: ${fileType}\n// Tổng số tệp: ${totalExtractedFiles} tệp\n// =========================================================================\n// • Click vào bất kỳ file nào trong cây thư mục bên trái để xem và sửa code.\n// • Nhấn Ctrl + S để lưu trực tiếp xuống ổ đĩa.\n// • Nhấp đúp RUN_APP.bat trong thư mục hoặc bấm nút [🚀 Chạy Ứng Dụng] để thử ngay!\n// =========================================================================\n`;

    // Nếu có file báo cáo cũ thì đọc nạp lại
    const reportPath = path.join(folderPath, 'python_decompile_report.txt');
    const evidencePath = path.join(folderPath, 'electron_analysis_evidence.json');
    if (fs.existsSync(reportPath)) {
      primaryOutputText = fs.readFileSync(reportPath, 'utf8');
    } else if (fs.existsSync(evidencePath)) {
      primaryOutputText = fs.readFileSync(evidencePath, 'utf8');
    }

    res.json({
      success: true,
      fileInfo: {
        name: baseName,
        fullPath: folderPath,
        size: stat.size,
        isDirectory: true,
        fileType
      },
      totalExtractedFiles,
      outputDir: folderPath,
      mainScriptPath,
      primaryOutputText: primaryOutputText.slice(0, 100000),
      extractedTree
    });

  } catch (err) {
    console.error('Lỗi mở dự án:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.5 API Lấy danh sách Dự Án Gần Đây
app.get('/api/project/recent', (req, res) => {
  res.json({ success: true, projects: getRecentProjects() });
});

// 3.6 API Xóa một dự án khỏi danh sách Gần Đây
app.post('/api/project/recent/remove', (req, res) => {
  const { folderPath } = req.body;
  if (folderPath) removeRecentProject(folderPath);
  res.json({ success: true, projects: getRecentProjects() });
});

// 3.7 API Khởi chạy ứng dụng trực tiếp từ mã nguồn vừa bung / vừa chỉnh sửa
app.post('/api/project/run-app', async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || !fs.existsSync(folderPath)) {
    return res.status(400).json({ success: false, error: 'Thư mục dự án không tồn tại!' });
  }

  try {
    const liveAppDir = path.join(folderPath, 'resources', 'app');
    const targetAsar = path.join(folderPath, 'resources', 'app.asar');

    // Nếu là dự án Electron Live Unpack: Đồng bộ ngay lập tức từ resources/app -> resources/app.asar (<850ms)
    if (fs.existsSync(liveAppDir) && asar && typeof asar.createPackage === 'function') {
      console.log(`[RUN] Đang đồng bộ resources/app -> ${targetAsar}...`);
      await asar.createPackage(liveAppDir, targetAsar);
      console.log(`[RUN] Đồng bộ hoàn tất!`);
    }

    // Tìm file EXE chính trong thư mục gốc
    const rootFiles = fs.readdirSync(folderPath);
    let exeToRun = null;

    // Ưu tiên file EXE chính (loại trừ elevate.exe)
    for (const file of rootFiles) {
      if (file.toLowerCase().endsWith('.exe') && file.toLowerCase() !== 'elevate.exe') {
        exeToRun = path.join(folderPath, file);
        break;
      }
    }

    if (exeToRun && fs.existsSync(exeToRun)) {
      console.log(`[RUN] Đang khởi chạy Native Executable: ${exeToRun}`);
      const child = spawn(exeToRun, [], {
        cwd: folderPath,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      return res.json({
        success: true,
        message: `Đã khởi chạy ứng dụng: ${path.basename(exeToRun)}`,
        exeName: path.basename(exeToRun)
      });
    }

    // Nếu không có EXE nhưng có RUN_APP.bat (VD: Python)
    const runBat = path.join(folderPath, 'RUN_APP.bat');
    if (fs.existsSync(runBat)) {
      console.log(`[RUN] Đang khởi chạy qua batch script: ${runBat}`);
      const child = spawn('cmd.exe', ['/c', 'RUN_APP.bat'], {
        cwd: folderPath,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      return res.json({
        success: true,
        message: 'Đã khởi chạy ứng dụng qua RUN_APP.bat',
        exeName: 'RUN_APP.bat'
      });
    }

    return res.status(404).json({
      success: false,
      error: 'Không tìm thấy file EXE hoặc RUN_APP.bat để khởi chạy trong thư mục này!'
    });

  } catch (err) {
    console.error('Lỗi khởi chạy app:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. API Mở thư mục chứa Source Code trực tiếp trên Windows Explorer
app.post('/api/project/open-folder', (req, res) => {
  const { folderPath } = req.body;
  const target = folderPath || DEFAULT_OUTPUT_DIR;

  if (!fs.existsSync(target)) {
    return res.status(404).json({ success: false, error: 'Thư mục không tồn tại' });
  }

  // Lệnh mở thư mục trong Windows Explorer
  exec(`explorer.exe "${target}"`, (err) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, openedPath: target });
  });
});

// 4.1 API Hộp Thoại Chọn Tệp Native (Windows File Explorer Hiện Đại)
app.post('/api/dialog/pick-file', (req, res) => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'pick_file.ps1');
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { encoding: 'utf8' }, (err, stdout) => {
    const filePath = stdout ? stdout.trim() : '';
    res.json({ success: !!filePath, selectedPath: filePath });
  });
});

// 4.2 API Hộp Thoại Chọn Thư Mục Native (Windows File Explorer Hiện Đại)
app.post('/api/dialog/pick-folder', (req, res) => {
  const { title = 'Chọn thư mục' } = req.body || {};
  const scriptPath = path.join(__dirname, '..', 'scripts', 'pick_folder.ps1');
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Title "${title}"`, { encoding: 'utf8' }, (err, stdout) => {
    const folderPath = stdout ? stdout.trim() : '';
    res.json({ success: !!folderPath, selectedPath: folderPath });
  });
});

// 4.3 API Hộp Thoại Lưu Tệp Native (Windows Save File Dialog - Save Module...)
app.post('/api/dialog/save-file', (req, res) => {
  const { title = 'Lưu gói ASAR mới', initialDir = '', defaultFileName = 'app_patched.asar' } = req.body || {};
  const scriptPath = path.join(__dirname, '..', 'scripts', 'save_file.ps1');
  const safeTitle = (title || '').replace(/"/g, '`"');
  const safeDir = (initialDir || '').replace(/"/g, '`"');
  const safeName = (defaultFileName || '').replace(/"/g, '`"');
  
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Title "${safeTitle}" -InitialDir "${safeDir}" -DefaultFileName "${safeName}"`, { encoding: 'utf8' }, (err, stdout) => {
    const selectedPath = stdout ? stdout.trim() : '';
    res.json({ success: !!selectedPath, selectedPath });
  });
});


// 5. API Tự Động Lưu Code Tái Tạo Từ AI vào Thư Mục Source Code
app.post('/api/project/save-ai-code', (req, res) => {
  const { folderPath, fileName, content } = req.body;
  if (!folderPath || !content) {
    return res.status(400).json({ success: false, error: 'Thiếu dữ liệu lưu' });
  }

  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const saveFile = path.join(folderPath, fileName || 'reconstructed_source.py');
    fs.writeFileSync(saveFile, content, 'utf8');
    res.json({ success: true, savedPath: saveFile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.1 API Agent Tìm kiếm chuỗi/mã nguồn trong toàn bộ dự án
app.post('/api/agent/search-code', (req, res) => {
  const { folderPath, query, maxResults = 30 } = req.body;
  if (!folderPath || !query || !fs.existsSync(folderPath)) {
    return res.status(400).json({ success: false, error: 'Thiếu đường dẫn hoặc từ khóa tìm kiếm' });
  }

  let searchDir = folderPath;
  const liveApp = path.join(folderPath, 'resources', 'app');
  if (fs.existsSync(liveApp)) {
    searchDir = liveApp;
  }

  const matches = [];
  const validExts = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.html', '.css', '.py', '.c', '.h', '.txt', '.bat']);
  const lowerQuery = query.toLowerCase();

  function scan(dir, depth = 0) {
    if (depth > 7 || matches.length >= maxResults) return;
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (matches.length >= maxResults) break;
        if (item === 'node_modules' || item === 'locales' || item === 'bin' || item.startsWith('.')) continue;

        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          scan(full, depth + 1);
        } else if (validExts.has(path.extname(item).toLowerCase()) && stat.size < 1024 * 1024 * 3) {
          try {
            const content = fs.readFileSync(full, 'utf8');
            if (content.toLowerCase().includes(lowerQuery)) {
              const lines = content.split('\n');
              for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                if (matches.length >= maxResults) break;
                if (lines[lineIdx].toLowerCase().includes(lowerQuery)) {
                  matches.push({
                    file: path.relative(folderPath, full).replace(/\\/g, '/'),
                    fullPath: full,
                    line: lineIdx + 1,
                    snippet: lines[lineIdx].trim().slice(0, 180)
                  });
                }
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  scan(searchDir);
  res.json({ success: true, query, totalMatches: matches.length, matches });
});

// 5.2 API Agent Tự động áp dụng code đã sửa vào file (Apply Patch / Edit File)
app.post('/api/agent/apply-code', async (req, res) => {
  const { folderPath, targetFile, content } = req.body;
  if (!folderPath || !targetFile || content === undefined) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin file hoặc nội dung' });
  }

  try {
    let resolvedPath = path.isAbsolute(targetFile) ? targetFile : path.join(folderPath, targetFile);
    // Nếu file chưa trỏ vào resources/app nhưng project có resources/app
    const liveApp = path.join(folderPath, 'resources', 'app');
    if (!fs.existsSync(resolvedPath) && fs.existsSync(liveApp)) {
      const candidate = path.join(liveApp, targetFile);
      if (fs.existsSync(candidate) || fs.existsSync(path.dirname(candidate))) {
        resolvedPath = candidate;
      }
    }

    const parent = path.dirname(resolvedPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, content, 'utf8');
    console.log(`[AGENT] Đã áp dụng mã nguồn tự động vào: ${resolvedPath}`);

    // Tự động đồng bộ Live App nếu nằm trong resources/app
    let syncedAsar = false;
    const normalized = resolvedPath.replace(/\\/g, '/');
    const appIdx = normalized.indexOf('/resources/app/');
    if (appIdx !== -1 && asar && typeof asar.createPackage === 'function') {
      const projectRoot = resolvedPath.substring(0, appIdx);
      const appDir = path.join(projectRoot, 'resources', 'app');
      const targetAsar = path.join(projectRoot, 'resources', 'app.asar');
      asar.createPackage(appDir, targetAsar).then(() => {
        console.log(`[AUTO-SYNC] Đã đồng bộ tức thì sau khi Agent sửa: ${targetAsar}`);
      }).catch(e => {});
      syncedAsar = true;
    }

    res.json({
      success: true,
      appliedFile: resolvedPath,
      relativeFile: path.relative(folderPath, resolvedPath).replace(/\\/g, '/'),
      size: Buffer.byteLength(content, 'utf8'),
      syncedAsar
    });
  } catch (err) {
    console.error('Lỗi Agent apply code:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. API Chat / Suy luận với DeepSeek-R1 (HỖ TRỢ STREAMING SSE CHỐNG TIMEOUT 524)
app.post('/api/chat', async (req, res) => {
  const { messages, contextEvidence, projectInfo } = req.body;
  const colabUrl = currentConfig.colabUrl;

  if (!colabUrl) {
    return res.status(400).json({ success: false, error: 'Chưa kết nối URL Colab. Vui lòng kết nối trước!' });
  }

  const endpoint = `${colabUrl.replace(/\/+$/, '')}/v1/chat/completions`;

  let systemPrompt = `Bạn là Trợ lý Dịch Ngược & Kỹ sư Lập trình Cấp cao (Autonomous Reverse Engineering Agent) trong REA Studio.
Nhiệm vụ của bạn:
1. Phân tích cấu trúc và logic từ tệp nhị phân, JavaScript, Electron, Python hoặc Assembly vừa được bung ra.
2. Tìm kiếm các thuật toán mã hóa, chuỗi bí mật, logic kiểm tra bản quyền / API / License.
3. Khi bạn muốn sửa code hoặc tạo file mới trong dự án, bạn PHẢI luôn đặt đường dẫn file ở DÒNG ĐẦU TIÊN của khối code với cú pháp:
\`\`\`javascript
// [FILE: đường_dẫn_tệp]
... nội dung mã nguồn hoàn chỉnh hoặc đoạn code đã vá ...
\`\`\`
Ví dụ:
\`\`\`javascript
// [FILE: dist/main.js]
// Đã bypass kiểm tra bản quyền
...
\`\`\`
Hệ thống REA Studio sẽ tự động tạo nút "⚡ ÁP DỤNG VÀO FILE" để người dùng áp dụng code thẳng vào ổ đĩa và tự động đồng bộ vào ứng dụng!`;

  if (projectInfo) {
    systemPrompt += `\n\n[DỰ ÁN ĐANG MỞ]: ${projectInfo.name || 'Project'} (${projectInfo.path || ''})\n[DANH SÁCH FILE CHÍNH]: ${projectInfo.files || 'dist/main.js, package.json'}`;
  }

  if (contextEvidence) {
    systemPrompt += `\n\n[DỮ LIỆU BÓC TÁCH]:\n${contextEvidence.slice(0, 4500)}`;
  }

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  // Thiết lập Server-Sent Events (SSE) để truyền dữ liệu tức thì, giữ kết nối luôn thông suốt
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  // Gửi 1 heartbeat ping ngay lập tức để Cloudflare nhận phản hồi trong vòng vài mili-giây
  res.write(': heartbeat\n\n');

  try {
    const fetchFn = globalThis.fetch || (await import('node-fetch')).default;
    const colabResponse = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentConfig.modelId || 'deepseek-r1-distill-qwen-14b',
        messages: fullMessages,
        temperature: currentConfig.temperature || 0.6,
        max_tokens: currentConfig.maxTokens || 4096,
        stream: true
      })
    });

    if (!colabResponse.ok) {
      const errText = await colabResponse.text();
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
      return res.end();
    }

    // Truyền từng token từ Colab về thẳng trình duyệt thời gian thực
    for await (const chunk of colabResponse.body) {
      res.write(chunk);
    }
    res.end();

  } catch (err) {
    console.error('Lỗi streaming Colab:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

function openDesktopWindow() {
  const edgePath1 = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const edgePath2 = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe";
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

  let browserPath = null;
  if (fs.existsSync(edgePath1)) browserPath = edgePath1;
  else if (fs.existsSync(edgePath2)) browserPath = edgePath2;
  else if (fs.existsSync(chromePath)) browserPath = chromePath;

  const url = `http://localhost:${PORT}`;
  console.log(`Đang mở cửa sổ Desktop App tại: ${url}`);
  if (browserPath) {
    exec(`"${browserPath}" --app=${url} --window-size=1450,920`, (err) => {
      if (err) exec(`start ${url}`);
    });
  } else {
    exec(`start ${url}`);
  }
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 REA STANDALONE DESKTOP STUDIO ĐANG CHẠY!`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`====================================================`);

  // Server đã sẵn sàng 100% -> Tự động bật cửa sổ Desktop App
  openDesktopWindow();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[LƯU Ý] Cổng ${PORT} đang được sử dụng bởi một tiến trình khác.`);
    console.log(`Đang tự động đóng tiến trình cũ và thử lại...`);
    exec(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /f /pid %a`, () => {
      setTimeout(() => server.listen(PORT, '0.0.0.0'), 1000);
    });
  } else {
    console.error('Lỗi khởi động server:', err);
  }
});

