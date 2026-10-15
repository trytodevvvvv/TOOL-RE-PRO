const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const PYCDC_EXE = path.join(BIN_DIR, 'pycdc.exe');
const PYCDAS_EXE = path.join(BIN_DIR, 'pycdas.exe');

/**
 * 1. Kiểm tra xem một tệp .EXE có phải được đóng gói bằng PyInstaller hay không
 */
function checkIsPyInstaller(exePath) {
  return new Promise((resolve) => {
    const absExePath = path.resolve(exePath);
    if (!fs.existsSync(absExePath) || !absExePath.toLowerCase().endsWith('.exe')) {
      return resolve({ isPyInstaller: false });
    }

    // Chạy pyinstxtractor-ng -i để kiểm tra cookie/header archive
    exec(`pyinstxtractor-ng -i "${absExePath}"`, { timeout: 15000, encoding: 'utf8' }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      if (output.includes('PyInstaller Archive Info') || output.includes('Found') && output.includes('CArchive')) {
        const verMatch = output.match(/Python version:\s*([0-9.]+)/i);
        const pythonVersion = verMatch ? verMatch[1] : 'Unknown';
        
        const entryMatch = output.match(/Entry points:\s*([^\r\n]+)/i);
        let entryPoints = [];
        if (entryMatch) {
          entryPoints = entryMatch[1].split(',').map(s => s.trim().replace(/\.pyc$/, ''));
        }

        return resolve({
          isPyInstaller: true,
          pythonVersion,
          entryPoints,
          rawInfo: output
        });
      }
      resolve({ isPyInstaller: false });
    });
  });
}

/**
 * 2. Bung toàn bộ PyInstaller EXE vào thư mục đích
 */
function extractPyInstallerArchive(exePath, outputDir) {
  return new Promise((resolve, reject) => {
    const absExePath = path.resolve(exePath);
    const absOutputDir = path.resolve(outputDir);
    console.log(`[PYTHON DECOMPILER] Đang bóc tách CArchive PyInstaller từ: ${absExePath}`);
    
    // Đảm bảo outputDir tồn tại
    if (!fs.existsSync(absOutputDir)) {
      fs.mkdirSync(absOutputDir, { recursive: true });
    }

    // Chạy pyinstxtractor-ng với cwd là absOutputDir
    exec(`pyinstxtractor-ng "${absExePath}"`, {
      cwd: absOutputDir,
      timeout: 90000,
      maxBuffer: 1024 * 1024 * 30,
      encoding: 'utf8'
    }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      console.log(`[PYTHON DECOMPILER] Kết quả extract:\n${output.slice(0, 500)}`);

      // Tìm thư mục _extracted vừa được tạo ra
      const baseName = path.basename(absExePath);
      const extractedSubDir = path.join(absOutputDir, `${baseName}_extracted`);

      let possibleEntryPoints = [];
      const entryRegex = /Possible entry point:\s*([a-zA-Z0-9_.-]+\.pyc)/gi;
      let match;
      while ((match = entryRegex.exec(output)) !== null) {
        possibleEntryPoints.push(match[1]);
      }

      if (fs.existsSync(extractedSubDir)) {
        // Di chuyển toàn bộ các tệp từ thư mục con ra thẳng thư mục outputDir
        try {
          const files = fs.readdirSync(extractedSubDir);
          for (const f of files) {
            const src = path.join(extractedSubDir, f);
            const dst = path.join(outputDir, f);
            if (fs.existsSync(dst)) {
              if (fs.statSync(dst).isDirectory()) {
                // Thư mục đã có, bỏ qua hoặc gộp
                continue;
              }
            }
            fs.renameSync(src, dst);
          }
          // Xóa thư mục rỗng
          try { fs.rmdirSync(extractedSubDir); } catch (e) {}
        } catch (moveErr) {
          console.warn('[PYTHON DECOMPILER] Lỗi dọn dẹp thư mục con:', moveErr.message);
        }
      }

      // Xác định entry point chính (loại trừ các helper pyiboot, pyimod)
      let mainEntry = '';
      const realEntries = possibleEntryPoints.filter(p => !p.startsWith('pyi') && !p.startsWith('struct'));
      if (realEntries.length > 0) {
        mainEntry = realEntries[0];
      } else if (possibleEntryPoints.length > 0) {
        mainEntry = possibleEntryPoints[possibleEntryPoints.length - 1];
      }

      resolve({
        success: true,
        mainEntry,
        possibleEntryPoints,
        output
      });
    });
  });
}

/**
 * 3. Dịch ngược một tệp .pyc thành .py bằng pycdc + uncompyle6 + pycdas
 */
function decompileSinglePyc(pycPath) {
  return new Promise((resolve) => {
    const dir = path.dirname(pycPath);
    const baseName = path.basename(pycPath, path.extname(pycPath));
    const targetPyPath = path.join(dir, `${baseName}.py`);
    const targetDisasmPath = path.join(dir, `${baseName}_disasm.txt`);

    let pyCode = '';
    let disasm = '';
    let isIncomplete = false;

    // 1. Dùng pycdc.exe (Hỗ trợ tốt nhất cho Python hiện đại 3.9 - 3.12)
    if (fs.existsSync(PYCDC_EXE)) {
      try {
        const cdcOut = execSync(`"${PYCDC_EXE}" "${pycPath}"`, { timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        if (cdcOut && cdcOut.trim().length > 0) {
          pyCode = cdcOut;
          if (cdcOut.includes('Decompyle incomplete') || cdcOut.includes('Unsupported opcode')) {
            isIncomplete = true;
          }
        }
      } catch (e) {
        if (e.stdout) {
          pyCode = e.stdout.toString('utf8');
          isIncomplete = true;
        }
      }
    }

    // 2. Nếu pycdc incomplete hoặc chưa có code, thử thêm uncompyle6 (nếu là Python <= 3.8)
    if (!pyCode || isIncomplete) {
      try {
        const uncompyleOut = execSync(`uncompyle6 "${pycPath}"`, { timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        if (uncompyleOut && uncompyleOut.trim().length > 20 && 
            !uncompyleOut.includes('Unsupported Python version') && 
            !uncompyleOut.includes('Unknown magic number')) {
          pyCode = uncompyleOut;
          isIncomplete = false;
        }
      } catch (e) {}
    }

    // 3. Trích xuất Disassembly Opcode bằng pycdas.exe (Để AI suy luận chính xác 100% nếu decompiler bị thiếu hàm)
    if (fs.existsSync(PYCDAS_EXE)) {
      try {
        const dasOut = execSync(`"${PYCDAS_EXE}" "${pycPath}"`, { timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        if (dasOut && dasOut.trim().length > 0) {
          disasm = dasOut;
          fs.writeFileSync(targetDisasmPath, disasm, 'utf8');
        }
      } catch (e) {}
    }

    // Nếu decompilation bị thiếu hàm hoặc incomplete, bổ sung phần Disassembly vào cuối file .py
    if (disasm && (isIncomplete || !pyCode || pyCode.length < 150)) {
      pyCode = `${pyCode ? pyCode.trim() + '\n\n' : ''}# ==============================================================================
# [REA REVERSE ENGINE] BYTECODE DISASSEMBLY & OPCODES (${path.basename(pycPath)}):
# ==============================================================================
"""
${disasm}
"""
`;
    }

    // Ghi file .py nếu có code
    if (pyCode) {
      fs.writeFileSync(targetPyPath, pyCode, 'utf8');
    }

    resolve({
      success: !!pyCode,
      pyPath: fs.existsSync(targetPyPath) ? targetPyPath : null,
      disasmPath: fs.existsSync(targetDisasmPath) ? targetDisasmPath : null,
      pyCode,
      disasm,
      isIncomplete
    });
  });
}

/**
 * 4. Quét và dịch ngược tất cả các file .pyc trong thư mục (Ưu tiên thư mục gốc trước)
 */
async function decompileAllPycFiles(dirPath, maxCount = 40) {
  const rootPycFiles = [];
  const subPycFiles = [];

  try {
    const rootItems = fs.readdirSync(dirPath);
    for (const item of rootItems) {
      const full = path.join(dirPath, item);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        // Quét thư mục con sau
        try {
          const subItems = fs.readdirSync(full);
          for (const si of subItems) {
            if (si.toLowerCase().endsWith('.pyc')) {
              subPycFiles.push(path.join(full, si));
            }
          }
        } catch (e) {}
      } else if (item.toLowerCase().endsWith('.pyc')) {
        rootPycFiles.push(full);
      }
    }
  } catch (e) {}

  // Gộp: ưu tiên các file ở thư mục gốc (code người dùng) trước, sau đó mới đến thư viện
  const pycFiles = [...rootPycFiles, ...subPycFiles].slice(0, maxCount);

  console.log(`[PYTHON DECOMPILER] Tìm thấy ${pycFiles.length} file .pyc để dịch ngược sang .py...`);
  const results = [];
  for (const p of pycFiles) {
    const res = await decompileSinglePyc(p);
    results.push({ file: p, ...res });
  }
  return results;
}

/**
 * 5. Tự động sinh file chạy RUN_APP.bat và build BUILD_NEW_EXE.bat cho Python Project
 */
function generatePythonRunnerScripts(outputDir, entryPointName) {
  const scriptName = entryPointName ? entryPointName.replace(/\.pyc$/, '.py') : 'main.py';

  // 1. RUN_APP.bat
  const runBat = `@echo off\r
title REA Studio - Running Decompiled Python App\r
color 0a\r
echo ================================================================\r
echo   DANG KHOI CHAY UNG DUNG PYTHON TRUC TIEP TU MA NGUON VUA BUNG...\r
echo   File chay chinh: ${scriptName}\r
echo ================================================================\r
echo.\r
python "%~dp0${scriptName}"\r
echo.\r
echo ================================================================\r
echo   Ung dung da dong.\r
echo ================================================================\r
pause\r
`;
  fs.writeFileSync(path.join(outputDir, 'RUN_APP.bat'), runBat, 'utf8');

  // 2. BUILD_NEW_EXE.bat
  const buildBat = `@echo off\r
title REA Studio - Build Decompiled Python to EXE\r
color 0b\r
echo ================================================================\r
echo   DANG DONG GOI MA NGUON THANH FILE EXE MOI (PYINSTALLER)...\r
echo ================================================================\r
echo.\r
pyinstaller --onefile --noconfirm "%~dp0${scriptName}"\r
echo.\r
echo ================================================================\r
echo   Qua trinh build hoan tat! Kiem tra file EXE trong thu muc dist/\r
echo ================================================================\r
pause\r
`;
  fs.writeFileSync(path.join(outputDir, 'BUILD_NEW_EXE.bat'), buildBat, 'utf8');
}

/**
 * 6. Kiểm tra xem một thư mục có phải là dự án Python Native / Cython không
 */
function isPythonProject(dirPath) {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
    const items = fs.readdirSync(dirPath);
    if (items.includes('main.py') || items.includes('requirements.txt')) return true;
    if (items.some(f => f.toLowerCase().endsWith('.py') || f.toLowerCase().endsWith('.pyd'))) return true;

    // Kiểm tra thư mục con modules nếu có
    const modulesDir = path.join(dirPath, 'modules');
    if (fs.existsSync(modulesDir) && fs.statSync(modulesDir).isDirectory()) {
      const modItems = fs.readdirSync(modulesDir);
      if (modItems.some(f => f.toLowerCase().endsWith('.py') || f.toLowerCase().endsWith('.pyd'))) return true;
    }
  } catch (e) {}
  return false;
}

/**
 * 7. Copy an toàn dự án Python, bỏ qua venv, .git, __pycache__, node_modules để xử lý siêu tốc
 */
function copyPythonProjectSafe(srcDir, dstDir) {
  const IGNORED_NAMES = new Set(['venv', '.git', '__pycache__', 'node_modules', '.idea', '.vscode']);
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name.toLowerCase())) continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);

    if (entry.isDirectory()) {
      copyPythonProjectSafe(srcPath, dstPath);
    } else {
      try {
        fs.copyFileSync(srcPath, dstPath);
      } catch (e) {}
    }
  }
}

/**
 * 8. Quét tất cả file .pyd và bóc tách Cython symbols, classes, methods, strings
 */
function scanPydFiles(dirPath) {
  const pydFiles = [];
  function walk(current) {
    try {
      const items = fs.readdirSync(current, { withFileTypes: true });
      for (const it of items) {
        const full = path.join(current, it.name);
        if (it.isDirectory()) {
          if (!['venv', '.git', '__pycache__'].includes(it.name.toLowerCase())) {
            walk(full);
          }
        } else if (it.name.toLowerCase().endsWith('.pyd')) {
          pydFiles.push(full);
        }
      }
    } catch (e) {}
  }
  walk(dirPath);

  const results = [];
  for (const p of pydFiles) {
    try {
      const buf = fs.readFileSync(p);
      const str = buf.toString('latin1');
      const relPath = path.relative(dirPath, p);

      // Trích xuất Cython symbols
      const symbols = [...new Set(str.match(/(?:[a-zA-Z0-9_]+\.)+[a-zA-Z0-9_.]+/g) || [])]
        .filter(s => s.length > 5 && !s.startsWith('api-ms-') && !s.includes('..'));

      // Phân loại các symbol liên quan đến Auth / License / Main
      const authSymbols = symbols.filter(s => 
        /auth|login|license|key|verify|boot|hwid|machine|bypass|check/i.test(s)
      );
      const mainSymbols = symbols.filter(s =>
        /main|app|runner|service|window|screen|start|init/i.test(s)
      );

      // Tìm các URLs
      const urls = [...new Set(str.match(/https?:\/\/[a-zA-Z0-9_.\-\/]+/g) || [])];

      results.push({
        file: relPath,
        sizeBytes: buf.length,
        totalSymbols: symbols.length,
        authSymbols: authSymbols.slice(0, 50),
        mainSymbols: mainSymbols.slice(0, 50),
        urls: urls.slice(0, 20)
      });
    } catch (e) {}
  }
  return results;
}

/**
 * 9. Phân tích toàn diện dự án Python Native & Cython (.pyd)
 */
async function analyzeCythonAndPythonProject(projectDir, outputDir) {
  console.log(`[PYTHON CYTHON ANALYZER] 🐍 Bắt đầu sao chép và phân tích dự án: ${projectDir} -> ${outputDir}`);
  // 1. Copy toàn bộ project ngoại trừ venv (giúp quá trình bung mã nguồn chỉ mất < 1 giây)
  copyPythonProjectSafe(projectDir, outputDir);

  // 2. Quét toàn bộ file .pyd và trích xuất cấu trúc C-Extension
  const pydAnalyses = scanPydFiles(outputDir);

  // 3. Đọc main.py nếu có
  let mainPyContent = '';
  let mainPyPath = path.join(outputDir, 'main.py');
  if (fs.existsSync(mainPyPath)) {
    mainPyContent = fs.readFileSync(mainPyPath, 'utf8');
  } else {
    // Tìm file .py đầu tiên trong thư mục gốc
    const pyFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.py'));
    if (pyFiles.length > 0) {
      mainPyPath = path.join(outputDir, pyFiles[0]);
      mainPyContent = fs.readFileSync(mainPyPath, 'utf8');
    }
  }

  // 4. Đọc requirements.txt nếu có
  let requirementsContent = '';
  const reqPath = path.join(outputDir, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    requirementsContent = fs.readFileSync(reqPath, 'utf8');
  }

  // 5. Kiểm tra venv gốc để tạo RUN_APP.bat chạy ngay lập tức với đầy đủ thư viện
  const originalVenvActivate = path.join(projectDir, 'venv', 'Scripts', 'activate.bat');
  const hasOriginalVenv = fs.existsSync(originalVenvActivate);

  const mainRelName = path.basename(mainPyPath);
  const runBatContent = `@echo off\r
title REA Studio - Running Decompiled Python App\r
color 0a\r
echo ================================================================\r
echo   DANG KHOI CHAY UNG DUNG PYTHON TRUC TIEP TU MA NGUON VUA BUNG...\r
echo   (Moi thay doi trong ${mainRelName} deu co hieu luc ngay lap tuc!)\r
echo ================================================================\r
cd /d "%~dp0"\r
${hasOriginalVenv ? `if exist "${originalVenvActivate}" (\r
    echo [OK] Dang su dung moi truong venv goc: ${path.join(projectDir, 'venv')}\r
    call "${originalVenvActivate}"\r
)\r\n` : ''}python "${mainRelName}"\r
pause\r
`;
  fs.writeFileSync(path.join(outputDir, 'RUN_APP.bat'), runBatContent, 'utf8');

  // 6. Tổng hợp Evidence Report
  const allAuthSymbols = [];
  const allMainSymbols = [];
  for (const pa of pydAnalyses) {
    allAuthSymbols.push(...pa.authSymbols);
    allMainSymbols.push(...pa.mainSymbols);
  }

  const evidenceReport = `[THÀNH CÔNG] ĐÃ PHÂN TÍCH VÀ BUNG MÃ NGUỒN DỰ ÁN PYTHON NATIVE / CYTHON (.PYD)
- Thư mục dự án: ${outputDir}
- Điểm khởi chạy chính: ${mainRelName}
- Tệp nhị phân Cython C-Extension (.pyd): ${pydAnalyses.length} tệp
${pydAnalyses.map(p => `  • ${p.file} (${(p.sizeBytes / 1024).toFixed(1)} KB)`).join('\n')}

================================================================================
THƯ VIỆN YÊU CẦU (requirements.txt):
================================================================================
${requirementsContent || '// Không có file requirements.txt'}

================================================================================
MÃ NGUỒN KHỞI CHẠY CHÍNH (${mainRelName}):
================================================================================
${mainPyContent || '// Không tìm thấy main.py'}

================================================================================
CẤU TRÚC HÀM XÁC THỰC & BẢN QUYỀN TRÍCH XUẤT TỪ C-EXTENSION (.PYD):
================================================================================
${allAuthSymbols.length > 0 ? [...new Set(allAuthSymbols)].map(s => `  🔑 ${s}`).join('\n') : '  (Không phát hiện symbol nhạy cảm rõ ràng)'}

================================================================================
CẤU TRÚC GIAO DIỆN CHÍNH & RUNNER TRÍCH XUẤT TỪ (.PYD):
================================================================================
${allMainSymbols.length > 0 ? [...new Set(allMainSymbols)].slice(0, 40).map(s => `  ⚡ ${s}`).join('\n') : '  (Chưa có symbol main)'}

================================================================================
CHIẾN LƯỢC BYPASS BẢN QUYỀN BẰNG PYTHON MONKEY-PATCHING:
================================================================================
Vì file "${mainRelName}" là mã nguồn Python mở hoàn toàn, bạn KHÔNG CẦN phải dịch ngược
mã máy C trong các tệp .pyd. Bạn chỉ cần chèn đoạn mã hook vào "${mainRelName}"
trước khi gọi hàm khởi chạy ứng dụng:
  1. Import module chứa lớp AuthScreen (ví dụ: import modules.app)
  2. Ghi đè hàm kiểm tra hoặc boot (ví dụ: modules.app.AuthScreen.boot = lambda self: self.open_main())
  3. Hoặc khởi chạy thẳng lớp MainApp (ví dụ: modules.app.MainApp())
`;

  fs.writeFileSync(path.join(outputDir, 'python_cython_evidence.json'), JSON.stringify({
    projectType: 'Python Native / Cython C-Extension (.pyd)',
    entryPoint: mainRelName,
    pydFiles: pydAnalyses,
    requirements: requirementsContent,
    authSymbols: [...new Set(allAuthSymbols)],
    mainSymbols: [...new Set(allMainSymbols)]
  }, null, 2), 'utf8');

  fs.writeFileSync(path.join(outputDir, 'python_decompile_report.txt'), evidenceReport, 'utf8');

  return {
    fileType: `Dự án Python Native / Cython (.pyd: ${pydAnalyses.length} tệp)`,
    mainScriptPath: mainPyPath,
    primaryOutputText: evidenceReport
  };
}

module.exports = {
  checkIsPyInstaller,
  extractPyInstallerArchive,
  decompileSinglePyc,
  decompileAllPycFiles,
  generatePythonRunnerScripts,
  isPythonProject,
  copyPythonProjectSafe,
  scanPydFiles,
  analyzeCythonAndPythonProject
};

