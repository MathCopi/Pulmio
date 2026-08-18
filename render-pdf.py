# Renderiza as paginas do PDF do QFD/DFMEA em WebP e gera assets.js com data URIs.
# Uso: python render-pdf.py
import base64
import io
import json
import os

import pypdfium2 as pdfium
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.join(os.path.dirname(HERE), "Casa da Qualidade & DFMEA · Pulmio.pdf")
OUT = os.path.join(HERE, "paginas")
os.makedirs(OUT, exist_ok=True)

# escala 3x sobre 72dpi = 216dpi: texto denso de matriz fica legivel com zoom
SCALE = 3.0
QUALITY = 82
MAX_W = 3200

doc = pdfium.PdfDocument(PDF)
print(f"paginas: {len(doc)}")

pages = []
for i in range(len(doc)):
    page = doc[i]
    bitmap = page.render(scale=SCALE)
    img = bitmap.to_pil().convert("RGB")

    if img.width > MAX_W:
        h = round(img.height * MAX_W / img.width)
        img = img.resize((MAX_W, h), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=QUALITY, method=6)
    data = buf.getvalue()

    with open(os.path.join(OUT, f"pagina-{i + 1}.webp"), "wb") as f:
        f.write(data)

    pages.append({
        "n": i + 1,
        "w": img.width,
        "h": img.height,
        "src": "data:image/webp;base64," + base64.b64encode(data).decode(),
    })
    print(f"  pagina {i + 1}: {img.width}x{img.height}  {len(data) / 1024:.0f}KB")

total = sum(len(p["src"]) for p in pages) / 1024 / 1024
print(f"total embutido (base64): {total:.2f}MB")

with open(os.path.join(HERE, "paginas", "pages.json"), "w", encoding="utf-8") as f:
    json.dump([{k: v for k, v in p.items()} for p in pages], f)
print("gravado paginas/pages.json")
