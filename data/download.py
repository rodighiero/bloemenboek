#!/usr/bin/env python3
"""Download all sheets of Agnes Block's 'Bloemen na 't leven gedaen' (Rijksmuseum RP-T-1948-119).

Usage:
    python3 download.py            # download images + metadata.csv
    python3 download.py --pdf      # also build a downscaled PDF of the whole book
"""
import argparse
import csv
import html
import io
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from PIL import Image

ALBUM = "RP-T-1948-119"
N_SHEETS = 196
# Cover (0), the ex libris pasted in the front (A), then sheets 1..196 — in book order.
KEYS = [0, "A", *range(1, N_SHEETS + 1)]
OUT_DIR = Path(__file__).resolve().parent
IMG_DIR = OUT_DIR / "images"
WORKERS = 4
RETRIES = 2  # retries after the first attempt
PDF_LONG_SIDE = 2000
HEADERS = {"User-Agent": "Mozilla/5.0 (personal archival download script)"}

MICR_RE = re.compile(r"https://iiif\.micr\.io/([A-Za-z0-9]+)/")
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S | re.I)
FIELDS = ["number", "object_number", "title", "micr_id", "image_url", "object_url", "filename"]


def slugify(text, maxlen=60):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return text[:maxlen].rstrip("-") or "untitled"


def get(session, url, **kw):
    last = None
    for attempt in range(RETRIES + 1):
        try:
            r = session.get(url, headers=HEADERS, timeout=120, **kw)
            r.raise_for_status()
            return r
        except requests.HTTPError as e:
            last = e
            if e.response is not None and e.response.status_code == 404:
                break
        except requests.RequestException as e:
            last = e
        if attempt < RETRIES:
            time.sleep(2 * (attempt + 1))
    raise last


def process(number, session, cache):
    object_number = ALBUM if number == 0 else f"{ALBUM}-{number}"
    object_url = f"https://www.rijksmuseum.nl/en/collection/{object_number}"

    row = cache.get(object_number)
    if row and (IMG_DIR / row["filename"]).exists():
        return row, "skipped"

    page = get(session, object_url).text
    m = MICR_RE.search(page)
    if not m:
        raise RuntimeError("no micr.io ID found on object page")
    micr_id = m.group(1)
    t = TITLE_RE.search(page)
    title = html.unescape(t.group(1)).strip() if t else ""
    title = re.sub(r"\s*-\s*Rijksmuseum\s*$", "", title)

    if number == 0:
        filename = "000_cover.jpg"
    elif number == "A":
        filename = f"000A_{slugify(title)}.jpg"
    else:
        filename = f"{number:03d}_{slugify(title)}.jpg"
    image_url = f"https://iiif.micr.io/{micr_id}/full/max/0/default.jpg"
    row = dict(number=number, object_number=object_number, title=title, micr_id=micr_id,
               image_url=image_url, object_url=object_url, filename=filename)

    dest = IMG_DIR / filename
    if dest.exists():
        return row, "skipped"
    data = get(session, image_url).content
    if not data.startswith(b"\xff\xd8"):
        raise RuntimeError("response is not a JPEG")
    tmp = dest.with_suffix(".jpg.part")
    tmp.write_bytes(data)
    tmp.rename(dest)
    return row, "downloaded"


def load_cache(csv_path):
    if not csv_path.exists():
        return {}
    with csv_path.open(newline="", encoding="utf-8") as f:
        return {r["object_number"]: r for r in csv.DictReader(f)}


def write_pdf(jpegs, pdf_path):
    """Minimal PDF writer: one page per JPEG, embedded as-is (DCTDecode), page size = image size at 150 dpi."""
    objs = []  # list of bytes, object i+1

    def add(b):
        objs.append(b)
        return len(objs)

    page_ids = []
    catalog_id = add(b"")  # placeholder
    pages_id = add(b"")    # placeholder
    for jpg_bytes, (w, h), mode in jpegs:
        cs = b"/DeviceGray" if mode == "L" else b"/DeviceRGB"
        img_id = add(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s "
                     b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n"
                     % (w, h, cs, len(jpg_bytes)) + jpg_bytes + b"\nendstream")
        pw, ph = w * 72 / 150, h * 72 / 150
        content = b"q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q" % (pw, ph)
        content_id = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
        page_ids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] "
                            b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
                            % (pages_id, pw, ph, img_id, content_id)))
    objs[catalog_id - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id
    kids = b" ".join(b"%d 0 R" % p for p in page_ids)
    objs[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))

    with open(pdf_path, "wb") as f:
        f.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, b in enumerate(objs, 1):
            offsets.append(f.tell())
            f.write(b"%d 0 obj\n" % i + b + b"\nendobj\n")
        xref = f.tell()
        f.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
        for off in offsets:
            f.write(b"%010d 00000 n \n" % off)
        f.write(b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
                % (len(objs) + 1, catalog_id, xref))


def build_pdf(rows, pdf_path):
    def pages():
        for r in rows:
            p = IMG_DIR / r["filename"]
            if not p.exists():
                continue
            with Image.open(p) as im:
                im = im.convert("L" if im.mode == "L" else "RGB")
                im.thumbnail((PDF_LONG_SIDE, PDF_LONG_SIDE), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=85, optimize=True)
                yield buf.getvalue(), im.size, im.mode
    # Generator keeps only one page in memory at a time while encoding, but write_pdf
    # collects object bytes; at ~0.5 MB per downscaled page that's ~100 MB total — fine.
    write_pdf(pages(), pdf_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", action="store_true", help="also build a downscaled PDF of the book")
    args = ap.parse_args()

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = OUT_DIR / "metadata.csv"
    cache = load_cache(csv_path)

    rows, failed, counts = {}, {}, {"downloaded": 0, "skipped": 0}
    with requests.Session() as session, ThreadPoolExecutor(WORKERS) as pool:
        futs = {pool.submit(process, n, session, cache): n for n in KEYS}
        for i, fut in enumerate(as_completed(futs), 1):
            n = futs[fut]
            try:
                row, status = fut.result()
                rows[n] = row
                counts[status] += 1
                print(f"[{i:3d}/{len(futs)}] {status:10s} {row['filename']}", flush=True)
            except Exception as e:
                failed[n] = str(e)
                print(f"[{i:3d}/{len(futs)}] FAILED     #{n}: {e}", file=sys.stderr, flush=True)

    # Keep previously known rows for sheets that failed this run.
    for n in failed:
        on = ALBUM if n == 0 else f"{ALBUM}-{n}"
        if on in cache:
            rows[n] = cache[on]
    ordered = [rows[n] for n in KEYS if n in rows]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(ordered)

    jpgs = sorted(IMG_DIR.glob("*.jpg"))
    total = sum(p.stat().st_size for p in jpgs)
    print(f"\nDownloaded this run: {counts['downloaded']}, already present: {counts['skipped']}")
    print(f"Files in {IMG_DIR}: {len(jpgs)} JPGs, {total / 1e9:.2f} GB")
    if failed:
        print(f"Failed ({len(failed)}):")
        for n in sorted(failed, key=KEYS.index):
            print(f"  #{n}: {failed[n]}")
    else:
        print("No failures.")

    if args.pdf:
        pdf_path = OUT_DIR / "Agnes-Block-Bloemen-na-t-leven-gedaen.pdf"
        print(f"\nBuilding PDF ({PDF_LONG_SIDE} px long side)…", flush=True)
        build_pdf(ordered, pdf_path)
        print(f"PDF: {pdf_path} ({pdf_path.stat().st_size / 1e6:.0f} MB)")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
