from pathlib import Path

from docx import Document
from pypdf import PdfReader


SUPPORTED_RESUME_SUFFIXES = frozenset({".pdf", ".docx", ".txt"})
MAX_RESUME_CHARS = 20_000


def extract_resume_text(path: Path, suffix: str) -> str:
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    elif suffix == ".docx":
        document = Document(str(path))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    elif suffix == ".txt":
        text = path.read_text(encoding="utf-8", errors="replace")
    else:
        raise ValueError("Upload a PDF, DOCX, or TXT resume.")

    normalized = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not normalized:
        raise ValueError("No readable text was found in this resume.")
    return normalized[:MAX_RESUME_CHARS]
