"""Turn uploaded files into plain text. Raises ValueError with a human-readable reason."""
import io
import zipfile
from pathlib import PurePosixPath

MAX_ZIP_FILES = 300


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    try:
        if name.endswith(".pdf"):
            from pypdf import PdfReader
            text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages)
            if len(text.strip()) < 20:
                raise ValueError("PDF has no extractable text (scanned image?). OCR is not supported yet.")
            return text
        if name.endswith(".docx"):
            from docx import Document
            return "\n".join(p.text for p in Document(io.BytesIO(data)).paragraphs)
        text = data.decode("utf-8", errors="replace")
        if "\x00" in text:
            raise ValueError("Unsupported binary file type.")
        return text
    except ValueError:
        raise
    except Exception as e:  # corrupt files etc.
        raise ValueError(f"Could not read file: {e}")


def expand_upload(filename: str, data: bytes):
    """Yield (filename, bytes) pairs; ZIPs are unpacked, other files pass through."""
    if not filename.lower().endswith(".zip"):
        yield filename, data
        return
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError(f"{filename} is not a valid ZIP file.")
    members = [m for m in z.infolist() if not m.is_dir() and "__MACOSX" not in m.filename]
    if len(members) > MAX_ZIP_FILES:
        raise ValueError(f"ZIP has more than {MAX_ZIP_FILES} files.")
    for m in members:
        if m.file_size > 10_000_000:
            continue
        yield PurePosixPath(m.filename).name, z.read(m)
