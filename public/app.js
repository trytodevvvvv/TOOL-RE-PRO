// REA DESKTOP STUDIO JAVASCRIPT LOGIC
let currentOutputDir = '';
let currentTargetInfo = null;
let currentEvidenceRaw = '';
let currentAiCode = '';
let copilotChatHistory = [];

// DNSPY MONACO MULTI-TAB EDITOR STATE
let monacoEditor = null;
let isMonacoReady = false;
const editorTabs = new Map();
let activeTabKey = 'evidence'; // 'evidence', 'ai', or absolute filePath

// Khởi tạo 2 tab mặc định của hệ thống
editorTabs.set('evidence', {
  key: 'evidence',
  title: 'Báo Cáo Evidence',
  filePath: null,
  icon: '📋',
  content: `// =========================================================================\n// REA STANDALONE DESKTOP DECOMPILER STUDIO (DNSPY MODE)\n// =========================================================================\n// • Chọn tệp/thư mục và bấm [DỊCH NGƯỢC & BUNG SOURCE CODE]\n// • Toàn bộ mã nguồn bung ra sẽ hiển thị ở cây thư mục bên trái.\n// • Click vào bất kỳ file nào để mở nhiều tab và sửa code trực tiếp như dnSpy!\n// =========================================================================`,
  savedContent: '',
  isDirty: false,
  language: 'json',
  isSystem: true
});

editorTabs.set('ai', {
  key: 'ai',
  title: 'Mã Nguồn Tái Tạo (AI)',
  filePath: null,
  icon: '⚡',
  content: `// DeepSeek-R1 (Colab T4) sẽ giải mã thuật toán và hiển thị code tại đây...`,
  savedContent: '',
  isDirty: false,
  language: 'python',
  isSystem: true
});

document.addEventListener('DOMContentLoaded', () => {
  initStudio();
  initPanelResizer();
  initChatScrollWatcher();
  initImagePasteWatcher();

  const chatInput = document.getElementById('copilot-user-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCopilotMessage();
      }
    });
  }

  const targetInput = document.getElementById('target-file-input');
  if (targetInput) {
    targetInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        startAutoDecompile();
      }
    });
  }
});

// 1. Khởi tạo & Tự động reset sạch sẽ thông tin cũ
async function initStudio() {
  // 1. Reset sạch toàn bộ ô nhập và giao diện về trạng thái ban đầu
  const targetInput = document.getElementById('target-file-input');
  if (targetInput) targetInput.value = '';

  const pathDisplay = document.getElementById('display-output-path');
  if (pathDisplay) pathDisplay.textContent = 'Chưa dịch ngược. Khi bấm nút, mã nguồn sẽ tự động bung ra tại đây.';

  const btnOpen = document.getElementById('btn-open-source-dir');
  if (btnOpen) btnOpen.classList.add('hidden');

  const btnRun = document.getElementById('btn-header-run-app');
  if (btnRun) btnRun.classList.add('hidden');

  const bannerBtn = document.getElementById('banner-btn-open');
  if (bannerBtn) bannerBtn.classList.add('hidden');

  const badge = document.getElementById('target-type-badge');
  if (badge) badge.textContent = 'Chờ tệp';

  const summary = document.getElementById('file-summary-card');
  if (summary) {
    summary.innerHTML = `
      <div class="summary-empty">
        <span>Chưa nạp tệp nào.<br>Dán hoặc chọn tệp vào thanh trên và bấm <b>[Dịch Ngược &amp; Bung Source Code]</b>!</span>
      </div>
    `;
  }

  const tree = document.getElementById('extracted-tree-container');
  if (tree) {
    tree.innerHTML = `
      <div class="item-placeholder">Các tệp mã nguồn (.js, .html, .py, .c, .json) được bung ra sẽ hiển thị tại đây...</div>
    `;
  }

  const codeDisplay = document.getElementById('code-display');
  if (codeDisplay) {
    codeDisplay.textContent = `// =========================================================================
// REA STANDALONE DESKTOP DECOMPILER STUDIO
// =========================================================================
// • Hướng dẫn:
// 1. Chọn tệp mục tiêu (EXE, DLL, ASAR, JS, APK...) ở thanh trên.
// 2. Nhấn nút [DỊCH NGƯỢC & BUNG SOURCE CODE].
// 3. Hệ thống sẽ TỰ ĐỘNG BUNG TOÀN BỘ MÃ NGUỒN vào thư mục DECOMPILED_OUTPUT
//    đồng thời DeepSeek-R1 trên Colab sẽ phân tích thuật toán và viết lại code!
// =========================================================================`;
  }

  // Reset biến bộ nhớ
  currentOutputDir = '';
  currentTargetInfo = null;
  currentEvidenceRaw = '';
  currentAiCode = '';
  copilotChatHistory = [];

  // Khởi động Monaco Editor & Danh sách Tab kiểu dnSpy
  initMonacoEditor();
  renderTabsList();
  loadRecentProjects();

  // 2. Trạng thái kết nối Colab (Mặc định phiên mới chưa kết nối, link cũ đã xóa sạch)
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success && data.config) {
      if (data.config.colabUrl) {
        document.getElementById('modal-colab-url').value = data.config.colabUrl;
        updateColabStatusUI(true, 'Colab GPU: Sẵn sàng');
      } else {
        document.getElementById('modal-colab-url').value = '';
        updateColabStatusUI(false, 'Chưa kết nối Colab');
      }
    }
  } catch (err) {
    console.error('Lỗi nạp status:', err);
  }
}

// 1.1 Mở hộp thoại chọn tệp Native của Windows
async function browseTargetFile() {
  document.body.style.cursor = 'wait';
  try {
    const res = await fetch('/api/dialog/pick-file', { method: 'POST' });
    const data = await res.json();
    if (data.success && data.selectedPath) {
      document.getElementById('target-file-input').value = data.selectedPath;
    }
  } catch (err) {
    console.error('Lỗi chọn tệp:', err);
  } finally {
    document.body.style.cursor = 'default';
  }
}

// 1.2 Mở hộp thoại chọn thư mục dự án Native của Windows
async function browseTargetFolder() {
  document.body.style.cursor = 'wait';
  try {
    const res = await fetch('/api/dialog/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chọn thư mục ứng dụng cần dịch ngược' })
    });
    const data = await res.json();
    if (data.success && data.selectedPath) {
      document.getElementById('target-file-input').value = data.selectedPath;
    }
  } catch (err) {
    console.error('Lỗi chọn thư mục:', err);
  } finally {
    document.body.style.cursor = 'default';
  }
}

// 1.3 Mở hộp thoại thay đổi thư mục lưu mã nguồn xuất ra
async function browseOutputDir() {
  document.body.style.cursor = 'wait';
  try {
    const res = await fetch('/api/dialog/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Chọn thư mục để bung toàn bộ mã nguồn ra',
        setAsDefaultOutput: true
      })
    });
    const data = await res.json();
    if (data.success && data.selectedPath) {
      currentOutputDir = data.selectedPath;
      document.getElementById('display-output-path').textContent = currentOutputDir;
      document.getElementById('banner-btn-open')?.classList.remove('hidden');
      document.getElementById('btn-open-source-dir')?.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Lỗi đổi thư mục:', err);
  } finally {
    document.body.style.cursor = 'default';
  }
}

// 1.4 Mở thư mục dự án đã bung trước đó (Không decompile lại, nạp tức thì trong 0.2s)
async function openExistingProjectDialog() {
  document.body.style.cursor = 'wait';
  try {
    const res = await fetch('/api/dialog/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Chọn thư mục dự án đã bung mã nguồn trước đó'
      })
    });
    const data = await res.json();
    if (data.success && data.selectedPath) {
      await loadExistingProject(data.selectedPath);
    }
  } catch (err) {
    console.error('Lỗi chọn thư mục dự án:', err);
  } finally {
    document.body.style.cursor = 'default';
  }
}

// Nạp toàn bộ cây thư mục và cấu trúc của dự án đã bung
async function loadExistingProject(folderPath) {
  if (!folderPath) return;
  document.body.style.cursor = 'wait';

  const badge = document.getElementById('target-type-badge');
  if (badge) badge.textContent = 'Đang nạp...';

  try {
    const res = await fetch('/api/project/open-existing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error);
    }

    currentOutputDir = data.outputDir;
    currentTargetInfo = data.fileInfo;
    currentEvidenceRaw = data.primaryOutputText || '';

    // Cập nhật banner đường dẫn & hiện các nút mở
    document.getElementById('display-output-path').textContent = currentOutputDir;
    document.getElementById('btn-open-source-dir')?.classList.remove('hidden');
    document.getElementById('banner-btn-open')?.classList.remove('hidden');
    document.getElementById('btn-header-run-app')?.classList.remove('hidden');

    // 1. Render tóm tắt tệp
    renderFileSummary(data.fileInfo, data.totalExtractedFiles);

    // 2. Render Cây thư mục mã nguồn
    renderExtractedTree(data.extractedTree, data.outputDir);

    // 3. Nạp lại danh sách Recent Projects
    loadRecentProjects();

    // 4. Hiển thị báo cáo / evidence vào tab
    const evTab = editorTabs.get('evidence');
    if (evTab) {
      evTab.content = data.primaryOutputText || `// Đã nạp thành công dự án: ${currentOutputDir}`;
      evTab.savedContent = evTab.content;
      selectSystemTab('evidence');
    }

    // 5. Nếu có file script chính (main.js hoặc main.py), tự động mở sang tab editor
    if (data.mainScriptPath) {
      const fileName = data.mainScriptPath.split(/[\\/]/).pop();
      setTimeout(() => {
        openFileInEditor(data.mainScriptPath, fileName);
      }, 300);
    }

    showToast(`📂 Đã mở dự án "${data.fileInfo.name}" (${data.totalExtractedFiles} tệp)!`);

  } catch (err) {
    alert(`Không thể mở dự án: ${err.message}`);
    if (badge) badge.textContent = 'Lỗi';
  } finally {
    document.body.style.cursor = 'default';
  }
}

// Nạp danh sách Dự Án Gần Đây (Recent Projects)
async function loadRecentProjects() {
  const container = document.getElementById('recent-projects-list');
  if (!container) return;

  try {
    const res = await fetch('/api/project/recent');
    const data = await res.json();

    if (!data.success || !data.projects || data.projects.length === 0) {
      container.innerHTML = `<div class="item-placeholder">Chưa có dự án nào gần đây...</div>`;
      return;
    }

    container.innerHTML = '';
    data.projects.forEach(p => {
      const itemEl = document.createElement('div');
      itemEl.className = 'recent-project-item';
      itemEl.title = p.path;
      itemEl.innerHTML = `
        <div class="recent-item-info">
          <div class="recent-item-title">📁 ${escapeHtml(p.name)}</div>
          <div class="recent-item-path">${escapeHtml(p.path)}</div>
        </div>
        <span class="recent-item-remove" title="Xóa khỏi lịch sử" onclick="removeRecentProject('${escapeHtml(p.path).replace(/'/g, "\\'")}', event)">×</span>
      `;
      itemEl.onclick = (e) => {
        if (e.target.classList.contains('recent-item-remove')) return;
        loadExistingProject(p.path);
      };
      container.appendChild(itemEl);
    });

  } catch (err) {
    console.warn('Lỗi nạp recent projects:', err);
  }
}

// Xóa một project khỏi danh sách Recent
async function removeRecentProject(folderPath, event) {
  if (event) event.stopPropagation();
  try {
    await fetch('/api/project/recent/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });
    loadRecentProjects();
  } catch (e) {}
}

// THANH TIẾN TRÌNH (PROGRESS BAR)
function updateProgressBar(percent, text, spinner = '⏳') {
  const container = document.getElementById('decompile-progress-container');
  const fill = document.getElementById('progress-fill');
  const percentEl = document.getElementById('progress-percent');
  const labelEl = document.getElementById('progress-step-label');

  if (container) container.classList.remove('hidden');
  if (fill) fill.style.width = `${percent}%`;
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (labelEl) labelEl.textContent = text;
}

function hideProgressBar(delay = 4000) {
  setTimeout(() => {
    const container = document.getElementById('decompile-progress-container');
    if (container) container.classList.add('hidden');
  }, delay);
}

// 2. DỊCH NGƯỢC & TỰ ĐỘNG BUNG TOÀN BỘ MÃ NGUỒN
async function startAutoDecompile() {
  const targetPath = document.getElementById('target-file-input').value.trim();
  if (!targetPath) {
    alert('Vui lòng dán hoặc chọn đường dẫn ứng dụng (thư mục hoặc file ASAR/EXE/APK) cần dịch ngược!');
    return;
  }

  const btn = document.getElementById('btn-auto-decompile');
  btn.disabled = true;
  btn.innerHTML = `<span class="status-dot online"></span> <span>ĐANG BUNG MÃ NGUỒN...</span>`;

  const codeDisplay = document.getElementById('code-display');
  codeDisplay.textContent = `--> BẮT ĐẦU DỊCH NGƯỢC & GIẢI NÉN TOÀN BỘ MÃ NGUỒN:\n${targetPath}\n\nĐang quét các gói archive bên trong và tiến hành bung ra ổ đĩa...`;

  // Cập nhật thanh tiến trình - Giai đoạn 1
  updateProgressBar(15, '[Giai đoạn 1/4] 🔍 Đang quét cấu trúc & nhận diện tệp archive (ASAR / Executable)...');

  const pTimer1 = setTimeout(() => {
    updateProgressBar(45, '[Giai đoạn 2/4] 📦 Đang giải nén & bung toàn bộ cây tệp mã nguồn vào thư mục đích...');
  }, 1200);

  const pTimer2 = setTimeout(() => {
    updateProgressBar(75, '[Giai đoạn 3/4] 🔬 REA Engine đang bóc tách phân tích JavaScript & Logic ứng dụng...');
  }, 3500);

  try {
    const res = await fetch('/api/project/auto-decompile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath, customOutputDir: currentOutputDir })
    });
    const data = await res.json();

    clearTimeout(pTimer1);
    clearTimeout(pTimer2);

    if (!data.success) {
      throw new Error(data.error);
    }

    currentTargetInfo = data.fileInfo;
    currentOutputDir = data.outputDir;
    currentEvidenceRaw = data.primaryOutputText;

    // Cập nhật banner đường dẫn & hiện nút mở thư mục
    document.getElementById('display-output-path').textContent = currentOutputDir;
    document.getElementById('btn-open-source-dir').classList.remove('hidden');
    document.getElementById('banner-btn-open').classList.remove('hidden');
    document.getElementById('btn-header-run-app')?.classList.remove('hidden');

    // 1. Render tóm tắt tệp
    renderFileSummary(data.fileInfo, data.totalExtractedFiles);

    // 2. Render Cây thư mục mã nguồn vừa được bung
    renderExtractedTree(data.extractedTree, data.outputDir);

    // 2.5 Cập nhật danh sách Dự Án Gần Đây
    loadRecentProjects();

    // 3. Cập nhật tiến trình & Hiển thị vào Code Viewer
    const totalFiles = data.totalExtractedFiles || (data.extractedTree ? data.extractedTree.length : 0);
    updateProgressBar(90, `⚡ [Giai đoạn 4/4] Đã bung ${totalFiles} tệp! Đang chuyển dữ liệu lên DeepSeek-R1 (Colab GPU)...`);

    const evTab = editorTabs.get('evidence');
    if (evTab) {
      evTab.content = data.primaryOutputText || `// Đã bung toàn bộ mã nguồn vào:\n// ${currentOutputDir}`;
      evTab.savedContent = evTab.content;
      selectSystemTab('evidence');
    }

    // Nếu có file mã nguồn chính (.py hoặc .js), tự động mở sang tab mới trong Monaco Editor
    if (data.mainScriptPath) {
      const fileName = data.mainScriptPath.split(/[\\/]/).pop();
      setTimeout(() => {
        openFileInEditor(data.mainScriptPath, fileName);
      }, 500);
    }

    // 4. Kích hoạt DeepSeek-R1 phân tích logic và lưu code vào thư mục
    await triggerAiAnalysis(data.fileInfo, data.primaryOutputText, data.outputDir);

    updateProgressBar(100, `✅ Hoàn tất 100%! Đã bung thành công ${totalFiles} tệp mã nguồn vào ổ đĩa.`, '🎉');
    hideProgressBar(6000);

  } catch (err) {
    clearTimeout(pTimer1);
    clearTimeout(pTimer2);
    alert(`Lỗi: ${err.message}`);
    codeDisplay.textContent = `❌ LỖI: ${err.message}`;
    updateProgressBar(100, `❌ Gặp lỗi: ${err.message}`);
    hideProgressBar(5000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span>DỊCH NGƯỢC &amp; BUNG SOURCE CODE</span>
    `;
  }
}

// Đọc và mở tệp vào tab soạn thảo dnSpy
async function openFileInEditor(filePath, fileName) {
  if (editorTabs.has(filePath)) {
    switchEditorTab(filePath);
    return;
  }

  try {
    const res = await fetch('/api/project/read-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    });
    const data = await res.json();
    const content = data.content !== undefined ? data.content : `// Lỗi nạp tệp: ${data.error}`;

    editorTabs.set(filePath, {
      key: filePath,
      title: fileName,
      filePath: filePath,
      icon: getFileIcon(fileName),
      content: content,
      savedContent: content,
      isDirty: false,
      language: detectLanguage(fileName),
      isSystem: false
    });

    renderTabsList();
    switchEditorTab(filePath);
  } catch (err) {
    alert(`Không thể đọc tệp ${fileName}: ${err.message}`);
  }
}

// Mở thư mục mã nguồn trên Windows Explorer
async function openOutputDirectory() {
  if (!currentOutputDir) {
    alert('Chưa có thư mục mã nguồn nào được bung ra!');
    return;
  }
  try {
    await fetch('/api/project/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: currentOutputDir })
    });
  } catch (err) {
    alert('Lỗi mở thư mục: ' + err.message);
  }
}

function renderFileSummary(info, totalFiles) {
  const badge = document.getElementById('target-type-badge');
  badge.textContent = info.fileType || 'Analyzed';

  const card = document.getElementById('file-summary-card');
  const sizeText = info.isDirectory ? 'Thư mục dự án' : `${(info.size / (1024 * 1024)).toFixed(2)} MB`;
  const filesInfo = totalFiles ? `<div class="summary-item"><span class="summary-label">Số tệp đã bung:</span> <span class="summary-val" style="color:#3fb950; font-weight:700;">${totalFiles} tệp</span></div>` : '';
  card.innerHTML = `
    <div class="summary-item"><span class="summary-label">Tên:</span> <span class="summary-val" title="${escapeHtml(info.name)}">${escapeHtml(info.name)}</span></div>
    <div class="summary-item"><span class="summary-label">Kích thước:</span> <span class="summary-val">${sizeText}</span></div>
    <div class="summary-item"><span class="summary-label">Định dạng:</span> <span class="summary-val">${escapeHtml(info.fileType)}</span></div>
    ${filesInfo}
  `;
}

function renderExtractedTree(tree, outputDir) {
  const container = document.getElementById('extracted-tree-container');
  container.innerHTML = '';

  if (!tree || tree.length === 0) {
    container.innerHTML = `<div class="item-placeholder">Mã nguồn đã được bung ra tại:<br><code>${escapeHtml(outputDir)}</code></div>`;
    return;
  }

  function appendNodes(nodes, depth = 0) {
    nodes.forEach(node => {
      const el = document.createElement('div');
      el.className = `tree-node ${node.isDir ? 'is-dir' : 'is-file'}`;
      el.style.paddingLeft = `${depth * 14 + 8}px`;
      const icon = node.isDir ? '📁' : getFileIcon(node.name);
      el.innerHTML = `<span>${icon}</span> <span>${escapeHtml(node.name)}</span>`;
      el.title = node.path;
      
      el.onclick = () => {
        if (!node.isDir) {
          openFileInEditor(node.path, node.name);
        } else {
          openOutputDirectory();
        }
      };
      container.appendChild(el);

      if (node.isDir && node.children && node.children.length > 0) {
        appendNodes(node.children, depth + 1);
      }
    });
  }

  appendNodes(tree);
}

function getFileIcon(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (['js', 'jsx', 'ts'].includes(ext)) return '📜';
  if (['json', 'yaml', 'yml'].includes(ext)) return '⚙️';
  if (['html', 'htm'].includes(ext)) return '🌐';
  if (['py'].includes(ext)) return '🐍';
  if (['pyc'].includes(ext)) return '⚙️';
  if (['bat', 'cmd'].includes(ext)) return '🚀';
  if (['c', 'cpp', 'h'].includes(ext)) return '⚡';
  if (['png', 'jpg', 'svg'].includes(ext)) return '🖼️';
  if (['txt', 'log'].includes(ext)) return '📝';
  return '📄';
}

// 3. DeepSeek-R1 phân tích và tự động lưu code tái tạo vào thư mục (STREAMING REAL-TIME)
async function triggerAiAnalysis(fileInfo, evidence, outputDir) {
  appendCopilotMessage('ai', `<b>⚡ Đã hoàn tất bung mã nguồn vào thư mục:</b><br><code>${escapeHtml(outputDir)}</code><br>DeepSeek-R1 đang phân tích các hàm trọng yếu và tái tạo mã nguồn Python/C++...`);

  // Lọc lấy các thông tin giá trị nhất của evidence (loại bỏ các log lặp parse_javascript_source)
  let cleanEvidence = evidence || '';
  try {
    const lines = cleanEvidence.split('\n').filter(l => !l.includes('"phase":"parse_javascript_source"'));
    cleanEvidence = lines.join('\n');
  } catch (e) {}

  const prompt = `Tôi vừa giải nén và dịch ngược tệp "${fileInfo.name}" (${fileInfo.fileType}) vào thư mục "${outputDir}".
Dưới đây là một phần dữ liệu bóc tách được:
\`\`\`text
${cleanEvidence.slice(0, 3000)}
\`\`\`
Nhiệm vụ của bạn:
1. Giải thích kiến trúc và cơ chế hoạt động của phần mềm này.
2. Tìm xem có hàm mã hóa, logic bản quyền (License), API bí mật nào không.
3. Tái tạo lại logic chính thành một đoạn mã nguồn Python hoặc C++ hoàn chỉnh và chú thích dễ hiểu.`;

  copilotChatHistory = [{ role: 'user', content: prompt }];
  const msgId = 'msg-' + Date.now();
  appendCopilotLoading(msgId);

  await streamCopilotChat(
    copilotChatHistory,
    cleanEvidence.slice(0, 3000),
    (currentFull) => {
      // Stream hiển thị trực tiếp từng từ lên giao diện
      renderCopilotResponse(msgId, currentFull, true);

      // Nếu đã bắt đầu sinh khối code, cập nhật vào tab AI ngay lập tức
      const codeMatch = currentFull.match(/```(?:python|c|cpp|javascript|js)?\n([\s\S]*?)```/i);
      if (codeMatch) {
        currentAiCode = codeMatch[1];
        const aiTab = editorTabs.get('ai');
        if (aiTab && currentAiCode !== aiTab.content) {
          aiTab.content = currentAiCode;
          aiTab.savedContent = currentAiCode;
          if (activeTabKey === 'ai') {
            updateEditorContentFromActiveTab();
          }
        }
      }
    },
    (finalReply) => {
      copilotChatHistory.push({ role: 'assistant', content: finalReply });
      renderCopilotResponse(msgId, finalReply, false);

      const codeMatch = finalReply.match(/```(?:python|c|cpp|javascript|js)?\n([\s\S]*?)```/i);
      currentAiCode = codeMatch ? codeMatch[1] : '';

      if (currentAiCode) {
        const aiTab = editorTabs.get('ai');
        if (aiTab) {
          aiTab.content = currentAiCode;
          aiTab.savedContent = currentAiCode;
          if (activeTabKey === 'ai') {
            updateEditorContentFromActiveTab();
          }
        }
        if (currentOutputDir) {
          saveAiCodeDirectly(currentOutputDir, 'reconstructed_source.py', currentAiCode);
        }
      }
    },
    (err) => {
      updateCopilotError(msgId, err);
    }
  );
}

// Lưu code của AI trực tiếp vào thư mục
async function saveAiCodeDirectly(folderPath, fileName, content) {
  try {
    await fetch('/api/project/save-ai-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath, fileName, content })
    });
    console.log(`Đã tự động lưu ${fileName} vào ${folderPath}`);
  } catch (e) {
    console.error('Lỗi lưu ai code:', e);
  }
}

function saveCurrentAiCode() {
  if (!currentAiCode) {
    alert('Chưa có mã nguồn tái tạo từ AI để lưu!');
    return;
  }
  const fileName = prompt('Nhập tên tệp muốn lưu:', 'reconstructed_source.py');
  if (fileName) {
    saveAiCodeDirectly(currentOutputDir, fileName, currentAiCode);
    alert(`✅ Đã lưu ${fileName} vào thư mục mã nguồn!`);
  }
}

// =========================================================================
// DNSPY MONACO MULTI-TAB & LIVE EDITING CORE
// =========================================================================

function initMonacoEditor() {
  if (typeof require !== 'undefined' && require.config) {
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
      isMonacoReady = true;
      const container = document.getElementById('monaco-editor-container');
      if (!container) return;

      monacoEditor = monaco.editor.create(container, {
        value: editorTabs.get('evidence')?.content || '',
        language: 'json',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        cursorBlinking: 'smooth',
        bracketPairColorization: { enabled: true },
        wordWrap: 'on',
        renderWhitespace: 'selection'
      });

      // Lắng nghe chỉnh sửa code trong editor (Dirty State)
      monacoEditor.onDidChangeModelContent(() => {
        onEditorContentChanged();
      });

      // Lắng nghe di chuyển con trỏ (Status Bar Ln, Col)
      monacoEditor.onDidChangeCursorPosition((e) => {
        const el = document.getElementById('sb-cursor-pos');
        if (el && e.position) {
          el.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        }
      });

      // Đăng ký lệnh Ctrl + S trong Monaco
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveActiveEditorFile();
      });

      updateEditorContentFromActiveTab();
    });
  }
}

function detectLanguage(fileName) {
  if (!fileName) return 'javascript';
  const ext = fileName.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'json':
      return 'json';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'py':
      return 'python';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return 'cpp';
    case 'xml':
    case 'svg':
      return 'xml';
    case 'md':
      return 'markdown';
    case 'bat':
    case 'cmd':
      return 'bat';
    case 'sh':
      return 'shell';
    case 'yaml':
    case 'yml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}

function renderTabsList() {
  const container = document.getElementById('editor-tabs-list');
  if (!container) return;

  container.innerHTML = `
    <div class="e-tab ${activeTabKey === 'evidence' ? 'active' : ''}" onclick="selectSystemTab('evidence')">
      <span class="tab-icon">📋</span>
      <span class="tab-title">Báo Cáo Evidence</span>
    </div>
    <div class="e-tab ${activeTabKey === 'ai' ? 'active' : ''}" onclick="selectSystemTab('ai')">
      <span class="tab-icon">⚡</span>
      <span class="tab-title">Mã Nguồn Tái Tạo (AI)</span>
    </div>
  `;

  editorTabs.forEach((tab) => {
    if (tab.isSystem) return;
    const tabEl = document.createElement('div');
    tabEl.className = `e-tab ${activeTabKey === tab.key ? 'active' : ''}`;
    tabEl.title = tab.filePath;
    tabEl.innerHTML = `
      <span class="tab-icon">${tab.icon}</span>
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      ${tab.isDirty ? '<span class="tab-dirty-dot" title="Chưa lưu"></span>' : ''}
      <span class="tab-close-btn" title="Đóng tab" onclick="closeEditorTab('${escapeHtml(tab.key)}', event)">×</span>
    `;
    tabEl.onclick = (e) => {
      if (e.target.classList.contains('tab-close-btn')) return;
      switchEditorTab(tab.key);
    };
    container.appendChild(tabEl);
  });
}

function selectSystemTab(type) {
  switchEditorTab(type);
}

function switchEditorTab(key) {
  if (!editorTabs.has(key)) return;
  activeTabKey = key;
  renderTabsList();
  updateEditorContentFromActiveTab();
}

function closeEditorTab(key, e) {
  if (e) e.stopPropagation();
  const tab = editorTabs.get(key);
  if (!tab || tab.isSystem) return;

  if (tab.isDirty) {
    if (!confirm(`Tệp "${tab.title}" có thay đổi chưa lưu. Bạn có chắc chắn muốn đóng?`)) {
      return;
    }
  }

  editorTabs.delete(key);
  if (activeTabKey === key) {
    // Chuyển sang tab gần nhất
    const keys = Array.from(editorTabs.keys());
    activeTabKey = keys.length > 0 ? keys[keys.length - 1] : 'evidence';
  }
  renderTabsList();
  updateEditorContentFromActiveTab();
}

function onEditorContentChanged() {
  const tab = editorTabs.get(activeTabKey);
  if (!tab || !monacoEditor) return;

  const currentVal = monacoEditor.getValue();
  tab.content = currentVal;
  const isDirty = !tab.isSystem && (currentVal !== tab.savedContent);

  if (tab.isDirty !== isDirty) {
    tab.isDirty = isDirty;
    renderTabsList();
    updateBreadcrumbs(tab);
    updateSaveButton(tab);
  }

  // Cập nhật số ký tự
  const charEl = document.getElementById('sb-char-count');
  if (charEl) charEl.textContent = `${currentVal.length.toLocaleString()} ký tự`;
}

function updateEditorContentFromActiveTab() {
  const tab = editorTabs.get(activeTabKey);
  if (!tab) return;

  if (monacoEditor && isMonacoReady) {
    const model = monacoEditor.getModel();
    if (model) {
      if (monacoEditor.getValue() !== tab.content) {
        monacoEditor.setValue(tab.content);
      }
      monaco.editor.setModelLanguage(model, tab.language);
    }
  } else {
    const display = document.getElementById('code-display');
    if (display) {
      display.textContent = tab.content;
      display.classList.remove('hidden');
    }
  }

  updateBreadcrumbs(tab);
  updateSaveButton(tab);
  updateStatusBar(tab);
}

function updateBreadcrumbs(tab) {
  const pathEl = document.getElementById('breadcrumb-path');
  const dirtyEl = document.getElementById('breadcrumb-dirty-badge');
  if (!pathEl || !dirtyEl) return;

  if (tab.isSystem) {
    pathEl.innerHTML = `<span class="bc-item">📁 SYSTEM</span><span class="bc-sep">/</span><span class="bc-item current">${escapeHtml(tab.title)}</span>`;
    dirtyEl.innerHTML = `<span class="status-clean">Chỉ đọc</span>`;
  } else {
    const parts = (tab.filePath || '').split(/[\\/]/).filter(Boolean);
    const displayParts = parts.slice(-3);
    const pathHtml = displayParts.map((p, idx) => {
      const isLast = idx === displayParts.length - 1;
      return `<span class="bc-item ${isLast ? 'current' : ''}">${isLast ? '📄 ' : '📁 '}${escapeHtml(p)}</span>`;
    }).join('<span class="bc-sep">/</span>');

    pathEl.innerHTML = pathHtml;
    dirtyEl.innerHTML = tab.isDirty 
      ? `<span class="status-dirty">● Chưa lưu thay đổi</span>` 
      : `<span class="status-clean">✓ Đã lưu</span>`;
  }
}

function updateSaveButton(tab) {
  const btn = document.getElementById('btn-editor-save');
  if (!btn) return;

  if (!tab || tab.isSystem) {
    btn.disabled = tab?.key !== 'ai';
    btn.classList.remove('has-changes');
  } else {
    btn.disabled = false;
    if (tab.isDirty) {
      btn.classList.add('has-changes');
    } else {
      btn.classList.remove('has-changes');
    }
  }
}

function updateStatusBar(tab) {
  const langEl = document.getElementById('sb-language');
  if (langEl) langEl.textContent = tab.language.toUpperCase();

  const charEl = document.getElementById('sb-char-count');
  if (charEl) charEl.textContent = `${(tab.content || '').length.toLocaleString()} ký tự`;
}

// 💾 Lưu file đang mở trực tiếp vào ổ đĩa (Ctrl + S)
async function saveActiveEditorFile() {
  const tab = editorTabs.get(activeTabKey);
  if (!tab) return;

  if (tab.isSystem) {
    if (tab.key === 'ai') {
      saveCurrentAiCode();
    } else {
      showToast('ℹ️ Báo cáo Evidence là tệp tổng hợp chỉ đọc.');
    }
    return;
  }

  const contentToSave = monacoEditor ? monacoEditor.getValue() : tab.content;
  const btn = document.getElementById('btn-editor-save');
  if (btn) btn.innerHTML = `<span>⏳ Đang lưu...</span>`;

  try {
    const res = await fetch('/api/project/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tab.filePath, content: contentToSave })
    });
    const data = await res.json();
    if (data.success) {
      tab.savedContent = contentToSave;
      tab.content = contentToSave;
      tab.isDirty = false;
      renderTabsList();
      updateBreadcrumbs(tab);
      updateSaveButton(tab);
      const syncNote = data.syncedAsar ? ' (⚡ Đã tự động đồng bộ Live App)' : '';
      showToast(`💾 Đã lưu "${tab.title}" (${(data.size / 1024).toFixed(1)} KB)${syncNote}!`);
    } else {
      alert(`Lỗi lưu tệp: ${data.error}`);
    }
  } catch (err) {
    alert(`Lỗi kết nối lưu tệp: ${err.message}`);
  } finally {
    if (btn) {
      btn.innerHTML = `<span>💾 Lưu (Ctrl+S)</span>`;
      updateSaveButton(tab);
    }
  }
}

// 🚀 Khởi chạy ứng dụng trực tiếp từ mã nguồn đã bung / vừa sửa
async function runLiveApp() {
  if (!currentOutputDir) {
    alert('Chưa có thư mục dự án nào được mở!');
    return;
  }

  const runBtn1 = document.getElementById('btn-editor-run');
  const runBtn2 = document.getElementById('btn-header-run-app');
  if (runBtn1) runBtn1.innerHTML = `<span>⏳ Đang chạy...</span>`;
  if (runBtn2) runBtn2.innerHTML = `<span>⏳ Đang chạy...</span>`;

  try {
    const res = await fetch('/api/project/run-app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: currentOutputDir })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🚀 ${data.message}`);
    } else {
      alert(`❌ Không thể khởi chạy: ${data.error}`);
    }
  } catch (err) {
    alert(`❌ Lỗi kết nối khởi chạy: ${err.message}`);
  } finally {
    if (runBtn1) runBtn1.innerHTML = `<span>🚀 Chạy Ứng Dụng</span>`;
    if (runBtn2) runBtn2.innerHTML = `<span>🚀 Chạy Ứng Dụng</span>`;
  }
}

// 🧹 Format làm đẹp code
function formatActiveEditorCode() {
  if (!monacoEditor || !isMonacoReady) return;
  const tab = editorTabs.get(activeTabKey);

  const formatAction = monacoEditor.getAction('editor.action.formatDocument');
  if (formatAction) {
    formatAction.run().catch(() => {});
  }

  if (tab && tab.language === 'json') {
    try {
      const parsed = JSON.parse(monacoEditor.getValue());
      monacoEditor.setValue(JSON.stringify(parsed, null, 2));
    } catch (e) {}
  }
  showToast('🧹 Đã format làm đẹp mã nguồn!');
}

// 📦 Đóng gói lại ASAR (Save Module style dnSpy)
async function repackCurrentAsar() {
  if (!currentOutputDir) {
    alert('Chưa có thư mục mã nguồn nào được bung ra để đóng gói lại!');
    return;
  }

  const defaultFileName = 'app.asar';

  document.body.style.cursor = 'wait';
  let targetAsarPath = '';

  try {
    // 1. Mở hộp thoại Save File Dialog chuẩn Windows (Save Module...)
    const dialogRes = await fetch('/api/dialog/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Chọn nơi lưu file ASAR đã chỉnh sửa (Save Module...)',
        initialDir: currentOutputDir,
        defaultFileName: defaultFileName
      })
    });
    const dialogData = await dialogRes.json();

    // Nếu người dùng bấm Hủy (Cancel)
    if (!dialogData.success || !dialogData.selectedPath) {
      document.body.style.cursor = 'default';
      return;
    }

    targetAsarPath = dialogData.selectedPath;
  } catch (err) {
    console.warn('Lỗi mở hộp thoại lưu:', err);
  } finally {
    document.body.style.cursor = 'default';
  }

  const btn = document.getElementById('btn-editor-repack');
  if (btn) btn.innerHTML = `<span>⏳ Đang đóng gói ASAR...</span>`;

  try {
    const res = await fetch('/api/project/repack-asar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        sourceDir: currentOutputDir,
        outputAsarPath: targetAsarPath
      })
    });
    const data = await res.json();
    if (data.success) {
      alert(`🎉 [THÀNH CÔNG] ĐÃ ĐÓNG GÓI XONG FILE ASAR MỚI!\n\n📁 File xuất ra:\n${data.asarPath}\n\n📦 Dung lượng: ${(data.sizeBytes / (1024 * 1024)).toFixed(2)} MB\n(Đã tự động lọc bỏ các file backup EXE 240MB để gói siêu nhẹ).\n\nBạn có thể copy file này vào app để chạy thử ngay!`);
      showToast('📦 Đã đóng gói ASAR thành công!');

      // Mở thư mục chứa file vừa tạo
      try {
        const lastSlash = Math.max(targetAsarPath.lastIndexOf('\\'), targetAsarPath.lastIndexOf('/'));
        const parentFolder = lastSlash > 0 ? targetAsarPath.substring(0, lastSlash) : currentOutputDir;
        fetch('/api/project/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath: parentFolder })
        });
      } catch (e) {}
    } else {
      alert(`❌ Lỗi đóng gói ASAR: ${data.error}`);
    }
  } catch (err) {
    alert(`❌ Lỗi kết nối: ${err.message}`);
  } finally {
    if (btn) btn.innerHTML = `<span>📦 Đóng Gói Lại (ASAR)</span>`;
  }
}

function copyViewerContent() {
  const content = monacoEditor ? monacoEditor.getValue() : (editorTabs.get(activeTabKey)?.content || '');
  navigator.clipboard.writeText(content);
  showToast('📋 Đã sao chép toàn bộ nội dung trong editor!');
}

function showToast(msg) {
  let toast = document.getElementById('studio-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'studio-toast';
    toast.style.cssText = 'position:fixed;bottom:35px;left:50%;transform:translateX(-50%);background:#1f6feb;color:#fff;padding:8px 18px;border-radius:6px;font-size:0.82rem;font-weight:600;z-index:9999;box-shadow:0 4px 15px rgba(0,0,0,0.5);transition:opacity 0.3s ease;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.opacity = '0';
  }, 3000);
}

// Bắt phím tắt Ctrl + S (Lưu file) & Ctrl + O (Mở dự án) toàn cục
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveActiveEditorFile();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    openExistingProjectDialog();
  }
});

// =========================================================================
// STREAMING COPILOT CHAT (CHỐNG TIMEOUT CLOUDFLARE 524)
// =========================================================================

async function streamCopilotChat(messages, contextEvidence, onChunk, onDone, onError) {
  try {
    const isAgent = document.getElementById('chk-agent-mode')?.checked ?? true;
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        contextEvidence: contextEvidence ? contextEvidence.slice(0, 3500) : '',
        agentMode: isAgent
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      let friendlyErr = errText;
      if (errText.includes('524: A timeout occurred') || errText.includes('Error code 524')) {
        friendlyErr = 'Đường hầm Cloudflare bị timeout (Mã 524). Vui lòng thử lại!';
      }
      throw new Error(friendlyErr);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Giữ lại phần chưa hoàn thành dòng

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // Heartbeat comments
        if (trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.error) {
              let errMsg = data.error;
              if (errMsg.includes('524: A timeout occurred') || errMsg.includes('Error code 524')) {
                errMsg = 'Đường hầm Cloudflare bị timeout (Mã 524). Vui lòng thử lại!';
              }
              throw new Error(errMsg);
            }
            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              onChunk(fullText, delta);
            }
          } catch (e) {
            if (trimmed.includes('"error"')) throw e;
          }
        }
      }
    }

    onDone(fullText);

  } catch (err) {
    let cleanErr = err.message;
    if (cleanErr.includes('524: A timeout occurred') || cleanErr.includes('Error code 524')) {
      cleanErr = 'Đường hầm Cloudflare bị timeout (Mã 524).';
    }
    onError(cleanErr);
  }
}

// BẬT / ẨN PANEL AI COPILOT CHATBOT
function toggleCopilotPanel() {
  const panel = document.querySelector('.panel-copilot');
  const btn = document.getElementById('btn-toggle-copilot');
  const resizer = document.getElementById('copilot-resizer');
  if (!panel) return;
  panel.classList.toggle('collapsed');
  const isCollapsed = panel.classList.contains('collapsed');
  if (btn) {
    btn.classList.toggle('active', !isCollapsed);
  }
  if (resizer) {
    resizer.style.display = isCollapsed ? 'none' : 'block';
  }
  if (monacoEditor) {
    setTimeout(() => monacoEditor.layout(), 100);
  }
}

// THANH KÉO CO GIÃN ĐỘ RỘNG KHUNG COPILOT
function initPanelResizer() {
  const resizer = document.getElementById('copilot-resizer');
  const panel = document.querySelector('.panel-copilot');
  if (!resizer || !panel) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = startX - e.clientX; // Kéo sang trái sẽ làm to khung copilot
    const newWidth = Math.max(300, Math.min(850, startWidth + deltaX));
    panel.style.width = `${newWidth}px`;
    if (monacoEditor) monacoEditor.layout();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      if (monacoEditor) monacoEditor.layout();
    }
  });
}

// =========================================================================
// IMAGE ATTACHMENT & TESSERACT OCR (SCREENSHOT PASTE CTRL+V)
// =========================================================================
let currentAttachedImage = null;

function initImagePasteWatcher() {
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          handleImageFile(file);
          const panel = document.querySelector('.panel-copilot');
          if (panel && panel.classList.contains('collapsed')) {
            toggleCopilotPanel();
          }
          break;
        }
      }
    }
  });
}

function triggerImagePicker() {
  const input = document.getElementById('chat-file-input');
  if (input) input.click();
}

function handleImagePicked(event) {
  const file = event.target.files?.[0];
  if (file) {
    handleImageFile(file);
  }
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const previewBar = document.getElementById('chat-image-preview-bar');
    const previewImg = document.getElementById('chat-img-preview');
    const ocrTextEl = document.getElementById('img-ocr-text');

    if (previewImg) previewImg.src = dataUrl;
    if (previewBar) previewBar.classList.remove('hidden');

    currentAttachedImage = {
      file,
      dataUrl,
      ocrText: '',
      isOcrDone: false
    };

    if (ocrTextEl) ocrTextEl.textContent = 'Đang nhận diện chữ & lỗi từ ảnh...';

    try {
      if (window.Tesseract) {
        const result = await Tesseract.recognize(file, 'eng');
        const text = result?.data?.text?.trim() || '';
        currentAttachedImage.ocrText = text;
        currentAttachedImage.isOcrDone = true;
        if (ocrTextEl) {
          ocrTextEl.textContent = text 
            ? `Đã nhận diện: "${text.slice(0, 40)}..."` 
            : 'Đã tải ảnh xong (Không phát hiện chữ)';
        }
      } else {
        currentAttachedImage.isOcrDone = true;
        if (ocrTextEl) ocrTextEl.textContent = 'Ảnh đã sẵn sàng gửi';
      }
    } catch (err) {
      console.warn('Lỗi OCR Tesseract:', err);
      currentAttachedImage.isOcrDone = true;
      if (ocrTextEl) ocrTextEl.textContent = 'Ảnh đã sẵn sàng gửi';
    }
  };
  reader.readAsDataURL(file);
}

function clearAttachedImage() {
  currentAttachedImage = null;
  const previewBar = document.getElementById('chat-image-preview-bar');
  const previewImg = document.getElementById('chat-img-preview');
  const fileInput = document.getElementById('chat-file-input');
  if (previewBar) previewBar.classList.add('hidden');
  if (previewImg) previewImg.src = '';
  if (fileInput) fileInput.value = '';
}

// =========================================================================
// COPILOT AI CHAT & CODING AGENT
// =========================================================================

async function sendCopilotMessage() {
  const inputEl = document.getElementById('copilot-user-input');
  const text = inputEl.value.trim();
  const attached = currentAttachedImage;

  if (!text && !attached) return;

  const displayText = text || '*(Gửi kèm ảnh chụp màn hình/lỗi)*';
  const imgUrl = attached ? attached.dataUrl : null;
  appendCopilotMessage('user', displayText, imgUrl);
  inputEl.value = '';

  userScrolledUp = false;
  scrollCopilotBottom(true);

  let fullPrompt = text;
  if (attached && attached.ocrText) {
    fullPrompt += `\n\n[DỮ LIỆU TỪ ẢNH CHỤP MÀN HÌNH MÀ NGƯỜI DÙNG VỪA GỬI]:\n${attached.ocrText}\n(Hãy phân tích lỗi hoặc thông tin trên ảnh chụp màn hình này để chẩn đoán và hướng dẫn / sửa code chi tiết cho người dùng)`;
  }

  // Clear preview sau khi gửi
  clearAttachedImage();

  copilotChatHistory.push({ role: 'user', content: fullPrompt });
  const msgId = 'msg-' + Date.now();
  appendCopilotLoading(msgId);

  // Thu thập ngữ cảnh toàn diện:
  let contextPayload = currentEvidenceRaw ? currentEvidenceRaw.slice(0, 3000) : '';

  // Nội dung tệp đang mở trên editor (nếu có)
  const activeTab = editorTabs.get(activeTabKey);
  if (activeTab && !activeTab.isSystem && monacoEditor) {
    const code = monacoEditor.getValue();
    if (code) {
      contextPayload += `\n\n[FILE ĐANG MỞ TRONG EDITOR: ${activeTab.title}]:\n${code.slice(0, 4500)}`;
    }
  }

  await streamCopilotChat(
    copilotChatHistory,
    contextPayload,
    (currentFull) => {
      renderCopilotResponse(msgId, currentFull, true);
    },
    (finalReply) => {
      copilotChatHistory.push({ role: 'assistant', content: finalReply });
      renderCopilotResponse(msgId, finalReply, false);
    },
    (err) => {
      updateCopilotError(msgId, err);
    }
  );
}

function askAiQuick(q) {
  const input = document.getElementById('copilot-user-input');
  input.value = q;
  sendCopilotMessage();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// KHO LƯU TRỮ CÁC BLOCK CODE ĐƯỢC AI TẠO RA ĐỂ ÁP DỤNG TRỰC TIẾP
window.aiCodeStore = window.aiCodeStore || {};

async function applyAiCodeFromStore(blockKey) {
  const item = window.aiCodeStore?.[blockKey];
  if (!item) {
    alert('Không tìm thấy thông tin code block!');
    return;
  }
  const btn = document.getElementById(`btn-apply-${blockKey}`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Đang áp dụng...</span>';
  }

  try {
    const res = await fetch('/api/agent/apply-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: item.filePath,
        code: item.code
      })
    });
    const data = await res.json();
    if (data.success) {
      if (btn) {
        btn.innerHTML = '<span>✅ Đã Áp Dụng!</span>';
        btn.style.background = '#238636';
      }
      showToast(`⚡ Đã tự động cập nhật ${data.relativePath}!`);

      // Nếu file này đang mở trong Monaco Editor thì cập nhật nội dung tức thì
      for (const [key, tab] of editorTabs.entries()) {
        if (tab.filePath && (tab.filePath === data.fullPath || tab.filePath.replace(/\\/g, '/').endsWith(data.relativePath.replace(/\\/g, '/')))) {
          tab.content = item.code;
          tab.savedContent = item.code;
          tab.isDirty = false;
          if (activeTabKey === key && monacoEditor) {
            monacoEditor.setValue(item.code);
          }
          renderEditorTabs();
          break;
        }
      }

      const asarMsg = data.asarSynced ? '\n📦 Đã tự động cập nhật đồng bộ trực tiếp vào file app.asar!' : '';
      alert(`🎉 [THÀNH CÔNG] ĐÃ ÁP DỤNG CODE THÀNH CÔNG!\n\n📄 File: ${data.relativePath}${asarMsg}\n\nBạn có thể chạy thử phần mềm hoặc tiếp tục chỉnh sửa.`);
    } else {
      if (btn) btn.innerHTML = originalHtml;
      alert(`❌ Lỗi khi áp dụng code: ${data.error}`);
    }
  } catch (err) {
    if (btn) btn.innerHTML = originalHtml;
    alert(`❌ Lỗi kết nối: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function formatMarkdown(md) {
  if (!md) return '';

  const codeBlocks = [];
  let processed = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const id = `__CODE_BLOCK_${codeBlocks.length}__`;
    const trimmedCode = code.trim();

    // Nhận diện annotation mục tiêu của AI Coding Agent: // [FILE: <path>] hoặc # [FILE: <path>]
    const fileMatch = trimmedCode.match(/^\s*(?:\/\/|#|\/\*)\s*\[FILE:\s*([^\s\]]+)\]/i);
    let headerHtml = '';
    let hasHeader = '';

    if (fileMatch) {
      const targetPath = fileMatch[1];
      const blockKey = 'cb_' + Math.random().toString(36).slice(2, 9);
      window.aiCodeStore[blockKey] = {
        filePath: targetPath,
        code: trimmedCode
      };

      headerHtml = `
        <div class="code-agent-header">
          <div class="target-path-badge">📄 <span>${escapeHtml(targetPath)}</span></div>
          <button class="btn-apply-code" id="btn-apply-${blockKey}" onclick="applyAiCodeFromStore('${blockKey}')" title="Tự động ghi code này vào file và build lại ASAR">
            <span>⚡ Áp Dụng Vào File</span>
          </button>
        </div>
      `;
      hasHeader = ' has-agent-header';
    }

    codeBlocks.push(`${headerHtml}<pre class="code-block-snippet${hasHeader}" style="background:#090d13;border:1px solid #30363d;border-radius:6px;padding:8px 10px;margin:8px 0;overflow-x:auto;"><div style="font-size:0.65rem;color:#8b949e;text-transform:uppercase;margin-bottom:4px;font-family:monospace;">${escapeHtml(lang || 'code')}</div><code style="font-family:monospace;font-size:0.8rem;color:#7ee787;">${escapeHtml(trimmedCode)}</code></pre>`);
    return id;
  });

  const inlineCodes = [];
  processed = processed.replace(/`([^`\n]+)`/g, (match, code) => {
    const id = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`<code style="background:rgba(110,118,129,0.2);color:#ff7b72;padding:2px 4px;border-radius:4px;font-family:monospace;font-size:0.82em;">${escapeHtml(code)}</code>`);
    return id;
  });

  // Headers
  processed = processed.replace(/^### (.*$)/gim, '<h4 style="margin:8px 0 4px 0;color:#58a6ff;font-size:0.95rem;">$1</h4>');
  processed = processed.replace(/^## (.*$)/gim, '<h3 style="margin:10px 0 5px 0;color:#79c0ff;font-size:1.05rem;">$1</h3>');
  processed = processed.replace(/^# (.*$)/gim, '<h2 style="margin:12px 0 6px 0;color:#a5d6ff;font-size:1.15rem;">$1</h2>');

  // Bold & Italic
  processed = processed.replace(/\*\*(.*?)\*\*/g, '<b style="color:#f0f6fc;">$1</b>');
  processed = processed.replace(/\*(.*?)\*/g, '<i>$1</i>');

  // Bullet points
  processed = processed.replace(/^\s*-\s+(.*$)/gim, '• $1<br>');
  processed = processed.replace(/^\s*\*\s+(.*$)/gim, '• $1<br>');

  // Newlines
  processed = processed.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');

  // Restore codes
  inlineCodes.forEach((codeHtml, i) => {
    processed = processed.replace(`__INLINE_CODE_${i}__`, codeHtml);
  });
  codeBlocks.forEach((codeHtml, i) => {
    processed = processed.replace(`__CODE_BLOCK_${i}__`, codeHtml);
  });

  return processed;
}

function renderCopilotResponse(msgId, content, isStreaming = false) {
  const el = document.getElementById(msgId);
  if (!el) return;

  let thinkText = '';
  let answerText = content;
  let isStillThinking = false;

  const thinkEndIdx = content.indexOf('</think>');
  const thinkStartIdx = content.indexOf('<think>');

  if (thinkStartIdx !== -1) {
    if (thinkEndIdx !== -1) {
      thinkText = content.slice(thinkStartIdx + 7, thinkEndIdx).trim();
      answerText = content.slice(thinkEndIdx + 8).trim();
    } else {
      isStillThinking = true;
      thinkText = content.slice(thinkStartIdx + 7).trim();
      answerText = '';
    }
  }

  let html = '';
  if (isStillThinking) {
    html += `
      <div class="thought-box">
        <div class="thought-header">
          <span class="status-dot online"></span>
          <span>🧠 DeepSeek-R1 đang suy nghĩ logic...</span>
        </div>
        <div id="${msgId}-th" class="thought-content" style="display:block;">${escapeHtml(thinkText)}<span class="streaming-cursor">▌</span></div>
      </div>
    `;
  } else if (thinkText) {
    html += `
      <div class="thought-box">
        <div class="thought-header" onclick="toggleThought('${msgId}-th')">
          <span>🧠 Suy luận DeepSeek-R1 (Bấm ẩn/hiện)</span>
          <span id="${msgId}-th-icon">▼</span>
        </div>
        <div id="${msgId}-th" class="thought-content">${escapeHtml(thinkText)}</div>
      </div>
    `;
  }

  if (answerText) {
    html += formatMarkdown(answerText);
    if (isStreaming) {
      html += '<span class="streaming-cursor">▌</span>';
    }
  }

  el.innerHTML = html;
  scrollCopilotBottom();
}

function toggleThought(id) {
  const el = document.getElementById(id);
  const icon = document.getElementById(`${id}-icon`);
  if (el) {
    if (el.style.display === 'none') {
      el.style.display = 'block';
      if (icon) icon.textContent = '▼';
    } else {
      el.style.display = 'none';
      if (icon) icon.textContent = '▶';
    }
  }
}

function appendCopilotMessage(role, content, imgUrl = null) {
  const box = document.getElementById('copilot-chat-box');
  const div = document.createElement('div');
  div.className = `c-msg c-msg-${role}`;
  
  let imgHtml = '';
  if (imgUrl) {
    imgHtml = `<div class="c-msg-image"><img src="${imgUrl}" alt="Ảnh người dùng gửi" /></div>`;
  }

  div.innerHTML = `
    <div class="c-msg-avatar">${role === 'user' ? '👤' : '🤖'}</div>
    <div class="c-msg-bubble">
      ${imgHtml}
      <div>${formatMarkdown(content)}</div>
    </div>
  `;
  box.appendChild(div);
  scrollCopilotBottom();
}

function appendCopilotLoading(msgId) {
  const box = document.getElementById('copilot-chat-box');
  const div = document.createElement('div');
  div.className = 'c-msg c-msg-ai';
  div.innerHTML = `
    <div class="c-msg-avatar">🤖</div>
    <div class="c-msg-bubble" id="${msgId}">
      <span class="status-dot online"></span> <i>DeepSeek-R1 đang suy nghĩ...</i>
    </div>
  `;
  box.appendChild(div);
  scrollCopilotBottom();
}

function updateCopilotError(msgId, err) {
  const el = document.getElementById(msgId);
  let cleanMsg = String(err || '');
  if (cleanMsg.includes('524') || cleanMsg.includes('timeout')) {
    cleanMsg = 'Lỗi kết nối Colab: Đường hầm Cloudflare bị timeout (524). Vui lòng thử lại!';
  } else if (cleanMsg.includes('<!DOCTYPE') || cleanMsg.includes('<html')) {
    cleanMsg = 'Lỗi phản hồi HTML từ máy chủ Cloudflare/Colab. Vui lòng kiểm tra lại tab Colab!';
  }
  if (el) el.innerHTML = `<span style="color: #f87171;">❌ ${escapeHtml(cleanMsg)}</span>`;
}

let userScrolledUp = false;

function initChatScrollWatcher() {
  const box = document.getElementById('copilot-chat-box');
  if (!box) return;
  box.addEventListener('scroll', () => {
    // Nếu khoảng cách tới đáy > 80px tức là người dùng đang chủ động cuộn lên đọc
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    userScrolledUp = distanceFromBottom > 80;
  });
}

function scrollCopilotBottom(force = false) {
  const box = document.getElementById('copilot-chat-box');
  if (!box) return;
  if (force || !userScrolledUp) {
    box.scrollTop = box.scrollHeight;
  }
}

// Modal Colab
function openColabModal() {
  document.getElementById('colab-modal').classList.remove('hidden');
}

function closeColabModal() {
  document.getElementById('colab-modal').classList.add('hidden');
}

async function modalTestColab() {
  const url = document.getElementById('modal-colab-url').value.trim();
  const statusBox = document.getElementById('modal-test-status');
  const btn = document.getElementById('btn-modal-test');
  const btnText = document.getElementById('modal-btn-text');

  if (!url) {
    alert('Vui lòng nhập link Cloudflare Colab!');
    return;
  }

  btn.disabled = true;
  btnText.textContent = 'Đang ping...';
  statusBox.className = 'test-result-box hidden';

  try {
    const res = await fetch('/api/colab/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (data.success) {
      statusBox.className = 'test-result-box success';
      statusBox.innerHTML = `✅ Kết nối thành công! Ping: <b>${data.latencyMs} ms</b>.`;
      updateColabStatusUI(true, `Colab GPU (${data.latencyMs}ms)`);
      setTimeout(closeColabModal, 1000);
    } else {
      statusBox.className = 'test-result-box error';
      statusBox.innerHTML = `❌ Thất bại: ${data.error}`;
      updateColabStatusUI(false, 'Colab: Ngoại tuyến');
    }
  } catch (err) {
    statusBox.className = 'test-result-box error';
    statusBox.innerHTML = `❌ Lỗi: ${err.message}`;
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Kết Nối';
  }
}

function updateColabStatusUI(isOnline, text) {
  const dot = document.getElementById('colab-dot');
  const txt = document.getElementById('colab-status-text');
  dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
  txt.textContent = text;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function copyColabScript() {
  const colabPythonCode = `# ==============================================================================
# DEEPSEEK-R1-DISTILL-QWEN-14B COLAB GPU SERVER (OLLAMA CUDA + CLOUDFLARED)
# Chạy tối ưu 100% trên Google Colab Tesla T4 GPU (16GB VRAM) - Không lỗi 502
# Cung cấp chuẩn OpenAI API: http://127.0.0.1:11434/v1
# ==============================================================================

# Dọn dẹp tiến trình cũ nếu chạy lại
!pkill -f "ollama" > /dev/null 2>&1
!pkill -f "cloudflared" > /dev/null 2>&1

# BƯỚC 1: Kiểm tra GPU & Cài đặt công cụ nền tảng (zstd, curl, wget) + Cloudflare
!nvidia-smi
!apt-get install -y zstd curl wget pciutils
!pip install -q huggingface_hub
!wget -q -nc https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
!dpkg -i cloudflared-linux-amd64.deb

# BƯỚC 2: Cài đặt Ollama Linux (Tự động kích hoạt GPU Tesla T4 CUDA)
print("--> [1/4] Đang cài đặt Ollama engine với CUDA GPU...")
!curl -fsSL https://ollama.com/install.sh | sh

# Khởi chạy Ollama daemon ngầm (Cấu hình cho phép Cloudflare Tunnel truy cập không bị 403)
import os, subprocess, time, re
os.environ["OLLAMA_ORIGINS"] = "*"
os.environ["OLLAMA_HOST"] = "0.0.0.0:11434"
subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)

# BƯỚC 3: Kiểm tra Model GGUF
MODEL_DIR = "./models"
os.makedirs(MODEL_DIR, exist_ok=True)
MODEL_PATH = f"{MODEL_DIR}/deepseek-r1-distill-qwen-14b-q4_k_m.gguf"

print("--> [2/4] Kiểm tra Model DeepSeek-R1-14B...")
if not os.path.exists(MODEL_PATH):
    from huggingface_hub import hf_hub_download
    file_path = hf_hub_download(
        repo_id="bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF",
        filename="DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
        local_dir=MODEL_DIR,
        local_dir_use_symlinks=False
    )
    if os.path.exists(file_path) and file_path != MODEL_PATH:
        os.rename(file_path, MODEL_PATH)

# BƯỚC 4: Nạp model vào Ollama với GPU Tesla T4 (Tối ưu VRAM ~14.0GB / 15.0GB)
print("--> [3/4] Đang nạp Model vào GPU T4 với Ollama...")
with open("Modelfile", "w") as f:
    f.write(f"""FROM {MODEL_PATH}
PARAMETER temperature 0.6
PARAMETER num_ctx 32768
PARAMETER num_batch 512
""")
!ollama create deepseek-r1-distill-qwen-14b -f Modelfile

# Tự động nạp trước (Warm-up) Model vào GPU Tesla T4 VRAM
print("--> Đang kích hoạt nạp Model vào GPU Tesla T4 VRAM...")
import urllib.request, json
try:
    req = urllib.request.Request(
        "http://127.0.0.1:11434/v1/chat/completions",
        data=json.dumps({
            "model": "deepseek-r1-distill-qwen-14b",
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    urllib.request.urlopen(req, timeout=30)
    print("⚡ [THÀNH CÔNG] Đã nạp Model vào GPU Tesla T4! VRAM đã sẵn sàng.")
except Exception as e:
    print(f"Lưu ý warm-up: {e}")

# BƯỚC 5: Mở đường hầm Cloudflare Tunnel tới cổng 11434 của Ollama
print("--> [4/4] Đang khởi tạo đường hầm Cloudflare...")
if os.path.exists("cloudflare.log"):
    os.remove("cloudflare.log")

tunnel_proc = subprocess.Popen(
    ["cloudflared", "tunnel", "--url", "http://127.0.0.1:11434", "--logfile", "cloudflare.log"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
)

for _ in range(35):
    time.sleep(1)
    if os.path.exists("cloudflare.log"):
        with open("cloudflare.log", "r", encoding="utf-8", errors="ignore") as f:
            matches = re.findall(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", f.read())
            if matches:
                print("\\n" + "=" * 65)
                print(f"🚀 LINK COLAB CỦA BẠN: {matches[0]}")
                print("=" * 65)
                print("👉 HÃY SAO CHÉP LINK NÀY VÀ DÁN VÀO REA STUDIO TRÊN MÁY TÍNH!")
                tunnel_proc.wait()
                break`;

  navigator.clipboard.writeText(colabPythonCode);
  alert('✅ ĐÃ SAO CHÉP MÃ COLAB MỚI VÀO BỘ NHỚ ĐỆM!\n\nBạn chỉ cần dán (Ctrl+V) vào Google Colab và bấm Play ▶.');
}


