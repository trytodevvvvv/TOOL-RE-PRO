# ==============================================================================
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

# BƯỚC 2: Cài đặt Ollama Linux (Tự động kích hoạt GPU Tesla T4 CUDA trong 10 giây)
print("--> [1/4] Đang cài đặt Ollama engine với CUDA GPU...")
!curl -fsSL https://ollama.com/install.sh | sh

# Khởi chạy Ollama daemon ngầm (Cấu hình cho phép Cloudflare Tunnel truy cập không bị 403)
import os, subprocess, time, re
os.environ["OLLAMA_ORIGINS"] = "*"
os.environ["OLLAMA_HOST"] = "0.0.0.0:11434"
subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)

# BƯỚC 3: Kiểm tra Model GGUF (Đã tải trước đó sẽ không cần tải lại!)
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

# BƯỚC 4: Nạp model vào Ollama với GPU Tesla T4
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
            matches = re.findall(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", f.read())
            if matches:
                print("\n" + "=" * 65)
                print(f"🚀 LINK COLAB CỦA BẠN: {matches[0]}")
                print("=" * 65)
                print("👉 HÃY SAO CHÉP LINK NÀY VÀ DÁN VÀO REA STUDIO TRÊN MÁY TÍNH!")
                tunnel_proc.wait()
                break
