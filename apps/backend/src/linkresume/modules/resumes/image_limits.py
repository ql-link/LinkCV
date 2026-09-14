MEBIBYTE = 1024 * 1024

# Resume image uploads and PDF export share this per-image contract. The PDF
# renderer receives base64 JSON, so its input envelope is kept separately.
MAX_RESUME_IMAGE_BYTES = 10 * MEBIBYTE
MAX_RESUME_PDF_IMAGE_TOTAL_BYTES = 10 * MEBIBYTE
RESUME_PDF_IMAGE_CONTENT_TYPES = frozenset({"image/jpeg", "image/png"})
