# 🚀 REA DESKTOP STUDIO PRO (NATIVE REVERSE ENGINEERING STUDIO)

<div align="center">

![REA Studio](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?style=for-the-badge&logo=windows)
![NodeJS](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs)
![DeepSeek-R1](https://img.shields.io/badge/AI%20Copilot-DeepSeek--R1--14B-4D5BCE?style=for-the-badge)
![Monaco Editor](https://img.shields.io/badge/Editor-Monaco%20Multi--Tab-1F2428?style=for-the-badge&logo=visualstudiocode)

**Công cụ Dịch Ngược, Tái Tạo Mã Nguồn & Live Editing Desktop App Toàn Diện**  
*Tự động bung 100% mã nguồn ẩn, clone runtime gốc và tích hợp AI DeepSeek-R1-14B trên GPU Tesla T4.*

</div>

---

## 🌟 Tính Năng Nổi Bật

### 1. 🔄 Kiến Trúc "Full Clone & Live Unpack"
- **Không chỉ bung mã nguồn, mà giữ nguyên 100% Runtime gốc:** Tự động clone toàn bộ file `.exe`, tất cả `.dll`, `icudtl.dat`, `*.pak`, `v8_context_snapshot.bin`, thư mục `locales/` và liên kết `resources/bin/` (Chromium portable, FFmpeg).
- **Tránh mọi lỗi thiếu phụ thuộc:** Ứng dụng chạy trực tiếp với đầy đủ môi trường native của nó, không cần tải thêm Electron từ internet, không bao giờ gặp lỗi thiếu DLL hay Chromium.
- **Bung toàn bộ mã nguồn ẩn:** Trích xuất file `app.asar` ra `resources/app/` (chứa toàn bộ `dist/`, `package.json`, JavaScript, HTML, CSS).
- **Bản sao lưu nguyên bản:** Tự động giữ `resources/app.asar.bak` để luôn có file đối chiếu gốc.

### 2. ⚡ Live Editing & Auto-Sync (Ctrl + S)
- Trình chỉnh sửa **Monaco Editor** đa tab (giao diện phong cách dnSpy).
- Mỗi khi bạn chỉnh sửa file trong `resources/app/` và bấm **`Ctrl + S`**, hệ thống tự động đồng bộ ngầm vào `resources/app.asar` chỉ trong **0.8 giây**.
- Bấm nút **`[🚀 Chạy Ứng Dụng]`** trực tiếp trên thanh công cụ để mở và kiểm tra thay đổi ngay lập tức!

### 3. 📦 Đóng Gói Lại ASAR (Save Module Style dnSpy)
- Hộp thoại lưu tệp Windows chuẩn (SaveFileDialog).
- Tự động lọc bỏ các file nặng không cần thiết (file backup EXE 240MB, `.bat`) để gói xuất ra siêu nhẹ, sẵn sàng deploy.

### 4. 🐍 Hỗ Trợ Ứng Dụng Python (PyInstaller Decompiler)
- Nhận diện ứng dụng Python đóng gói (`.exe` PyInstaller hoặc thư mục).
- Tự động trích xuất archive và dịch ngược toàn bộ file bytecode `.pyc` sang mã nguồn `.py` chuẩn.
- Tự động tạo `RUN_APP.bat` và `BUILD_NEW_EXE.bat`.

### 5. 🧠 Trợ Lý AI Dịch Ngược DeepSeek-R1-14B (Colab GPU)
- Kết nối trực tiếp với GPU Tesla T4 (16GB VRAM) trên Google Colab qua Cloudflare Tunnel.
- Tối ưu Context Window lên **24K tokens**, VRAM đạt ~13.5 GB / 15.0 GB để phân tích các file code lớn.
- Khung Chatbot dạng split-panel có thể kéo giãn độ rộng (300px - 850px) và hỗ trợ Server-Sent Events (SSE) streaming không bị timeout.

---

## 📂 Cấu Trúc Dự Án

```
TOOL-RE-PRO/
├── bin/                       # Bộ công cụ dịch ngược Python bytecode (pycdc, pycdas)
├── colab/                     # Script chạy DeepSeek-R1 trên Google Colab T4 GPU
│   ├── DeepSeek_R1_14B_Colab_Server.ipynb
│   └── colab_server.py
├── public/                    # Giao diện Frontend Studio (HTML5, Monaco Editor, CSS3)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── scripts/                   # PowerShell Native Dialog Scripts (pick-file, pick-folder, save-file)
├── server/                    # Backend API Server Node.js / Express
│   ├── index.js               # Core routing, auto-decompile, live unpack, runner
│   └── python_decompiler.js   # Module xử lý bóc tách PyInstaller & bytecode
├── DECOMPILED_OUTPUT/         # Thư mục lưu mã nguồn xuất ra (mặc định)
├── package.json
└── start.bat                  # File khởi động 1-click
```

---

## 🚀 Hướng Dẫn Cài Đặt & Sử Dụng

### Yêu Cầu Hệ Thống:
- **Hệ điều hành:** Windows 10 / 11 (64-bit)
- **Node.js:** Phiên bản 18+ ([Tải tại đây](https://nodejs.org/))

### Cài Đặt:
```bash
# 1. Clone repository
git clone https://github.com/trytodevvvvv/TOOL-RE-PRO.git
cd TOOL-RE-PRO

# 2. Cài đặt các gói phụ thuộc
npm install
```

### Sử Dụng:
1. **Khởi chạy Studio:**
   - Nhấp đúp vào **`start.bat`** (hoặc chạy lệnh `npm start`).
   - Cửa sổ Native Desktop Studio sẽ tự động mở lên tại `http://localhost:3399`.
2. **Kết nối GPU DeepSeek-R1 (Tùy chọn):**
   - Mở file trong thư mục `colab/DeepSeek_R1_14B_Colab_Server.ipynb` trên Google Colab với GPU T4.
   - Bấm Run All và sao chép link Cloudflare (`https://xxxx.trycloudflare.com`).
   - Dán vào mục **[⚙️ Kết Nối Colab T4]** trên Studio.
3. **Dịch Ngược Ứng Dụng:**
   - Dán đường dẫn thư mục ứng dụng hoặc file `.exe`/`.asar`/`.pyc` vào ô tìm kiếm.
   - Bấm **`[DỊCH NGƯỢC & BUNG SOURCE CODE]`**.
   - Toàn bộ runtime và mã nguồn sẽ được bung ra, cho phép bạn xem, sửa và bấm **`[🚀 Chạy Ứng Dụng]`** ngay lập tức!

---

## 📜 Giấy Phép
Dự án được xây dựng phục vụ mục đích nghiên cứu, học tập kiến trúc mã nguồn và kiểm thử bảo mật ứng dụng.
