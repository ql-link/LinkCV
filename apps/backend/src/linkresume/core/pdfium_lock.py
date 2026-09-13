"""PDFium calls, including native object cleanup, must be serialized per process."""
from threading import RLock

PDFIUM_LOCK = RLock()
