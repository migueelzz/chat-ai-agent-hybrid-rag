import os
import time
import requests

API_URL = "http://backend:8000/ingest/pdf"
DOCS_PATH = "/docs"
FLAG_FILE = "/state/ingested.flag"


def detect_module(filename: str) -> str:
    filename = filename.upper()
    if "FI" in filename:
        return "FI"
    if "MM" in filename:
        return "MM"
    if "SD" in filename:
        return "SD"
    if "PP" in filename:
        return "PP"
    return "FI"


def wait_backend():
    print("⏳ Aguardando backend subir...")
    for _ in range(30):
        try:
            r = requests.get("http://backend:8000/")
            if r.status_code == 200:
                print("✅ Backend pronto!")
                return
        except:
            pass
        time.sleep(2)
    raise Exception("❌ Backend não respondeu")


def already_ingested():
    return os.path.exists(FLAG_FILE)


def mark_as_done():
    os.makedirs("/state", exist_ok=True)
    with open(FLAG_FILE, "w") as f:
        f.write("done")


def ingest_all():
    for file in os.listdir(DOCS_PATH):
        if not file.endswith(".pdf"):
            continue

        filepath = os.path.join(DOCS_PATH, file)
        modulo = detect_module(file)

        print(f"📄 Enviando {file} (módulo {modulo})")

        with open(filepath, "rb") as f:
            response = requests.post(
                API_URL,
                files={"file": (file, f, "application/pdf")},
                data={"modulo": modulo},
            )

        if response.status_code == 200:
            print(f"✅ Sucesso: {file}")
        else:
            print(f"❌ Erro: {file} -> {response.text}")


if __name__ == "__main__":
    if already_ingested():
        print("⚠️ Ingest já executado anteriormente. Pulando...")
        exit(0)

    wait_backend()
    ingest_all()
    mark_as_done()

    print("🎉 Ingest finalizado com sucesso!")