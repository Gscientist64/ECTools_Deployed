# backend/run_desktop.py
import threading, time
from waitress import serve
import webview
from app import create_app

def run_server():
    app = create_app()
    serve(app, host="127.0.0.1", port=5000)

if __name__ == "__main__":
    t = threading.Thread(target=run_server, daemon=True)
    t.start()
    time.sleep(0.8)
    webview.create_window("EC Tools", "http://127.0.0.1:5000", width=1200, height=800)
    webview.start()
