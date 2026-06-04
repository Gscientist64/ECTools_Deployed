# tools/make_ico.py
from PIL import Image

SRC = "ecews_ms.jpg"        # <- put your logo file here (jpg/png)
OUT = "app.ico"

img = Image.open(SRC).convert("RGBA")
img = img.resize((256, 256))
img.save(OUT, format="ICO", sizes=[(256, 256)])
print("Saved:", OUT)
