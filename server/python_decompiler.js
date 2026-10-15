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

module.exports = {
  checkIsPyInstaller,
  extractPyInstallerArchive,
  decompileSinglePyc,
  decompileAllPycFiles,
  generatePythonRunnerScripts
};
