# Recorta e prepara as fotos da equipe para os avatares circulares.
# Le as fotos originais de fora do repo (pasta do projeto) e grava versoes
# quadradas, pequenas e sem EXIF em pulmio-site/pessoas/. So o recorte fica
# publico; o arquivo original do celular nunca entra no repositorio.
# Uso: python gen-avatars.py
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
OUT = os.path.join(HERE, "pessoas")
os.makedirs(OUT, exist_ok=True)

SIZE = 480    # lado final, quadrado
QUALITY = 87

# (arquivo, caixa de recorte em pixels da foto original: L, T, R, B)
# a máscara circular do CSS já esconde os cantos do quadrado, entao a caixa
# so precisa centralizar o rosto, nao isolar a pessoa com precisao
PESSOAS = [
    ("Eduarda.jpeg", "eduarda", (90, 0, 550, 460)),
    ("Mariana.jpeg", "mariana", (152, 336, 952, 1136)),   # foto nova, 1200x1600
    ("Matheus.jpeg", "matheus", (35, 0, 355, 320)),       # foto nova, 400x400
    ("Thales.jpeg",  "thales",  (260, 70, 640, 450)),
]

for arq, slug, caixa in PESSOAS:
    caminho = os.path.join(SRC, arq)
    if not os.path.exists(caminho):
        print(f"AVISO: {arq} nao encontrado em {SRC}, pulando")
        continue
    im = Image.open(caminho).convert("RGB")
    im = im.crop(caixa).resize((SIZE, SIZE), Image.LANCZOS)
    destino = os.path.join(OUT, slug + ".webp")
    im.save(destino, format="WEBP", quality=QUALITY, method=6)  # save() sem exif= já descarta metadados
    print(f"  {slug}: {im.size} <- {arq} {caixa}  ({os.path.getsize(destino)/1024:.0f}KB)")

print("gravado em", OUT)
