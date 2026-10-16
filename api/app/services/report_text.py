"""Report text intake: PDF or plain text -> normalised text + sentences with offsets.

Offsets: `start`/`end` index the normalised text, `source_start`/`source_end` index the original
extracted text, so a highlight can be drawn on either. Whitespace is normalised but characters
are never changed, so a verbatim quote from a sentence is also verbatim in the source.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

MAX_PDF_BYTES = 5 * 1024 * 1024
MAX_PDF_PAGES = 20
MAX_TEXT_CHARS = 100_000

ABBREVIATIONS = {
    "dr", "mr", "mrs", "ms", "prof", "st", "vs", "fig", "figs", "approx", "ca", "cf", "e.g", "i.e",
    "eg", "ie", "etc", "no", "pt", "dept", "ref", "vol",
}  # fmt: skip
TERMINALS = ".!?"
CONTINUATION_PREV = ",;(-"


class ReportReadError(Exception):
    """The report could not be read; the message is safe to show to the user."""


@dataclass
class Sentence:
    id: str
    text: str
    start: int
    end: int
    source_start: int
    source_end: int
    line: int
    page: int | None

    def as_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class ReportText:
    raw: str
    normalised: str
    sentences: list[Sentence] = field(default_factory=list)


def pdf_to_text(data: bytes) -> tuple[str, list[int | None]]:
    """Extract text with pdfplumber. Returns (text, page number for each line)."""
    import pdfplumber

    if len(data) > MAX_PDF_BYTES:
        raise ReportReadError("The PDF is larger than 5 MB.")
    if not data.startswith(b"%PDF"):
        raise ReportReadError("The file is not a PDF.")
    lines: list[str] = []
    pages: list[int | None] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            if len(pdf.pages) > MAX_PDF_PAGES:
                raise ReportReadError(f"The PDF has more than {MAX_PDF_PAGES} pages.")
            for number, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                for line in text.splitlines():
                    lines.append(line)
                    pages.append(number)
    except ReportReadError:
        raise
    except Exception as exc:  # pdfminer raises many types on corrupt files
        raise ReportReadError("The PDF could not be opened.") from exc
    text = "\n".join(lines)
    if not text.strip():
        raise ReportReadError("The PDF has no text layer (it may be a scan).")
    return text, pages


def _collapse_whitespace(raw: str) -> tuple[str, list[int]]:
    """Collapse runs of spaces and tabs, trim lines, drop blank lines. Map each char back."""
    out: list[str] = []
    mapping: list[int] = []
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    # offsets are preserved because \r\n -> \n only happens for text from files, never mapped
    # to anything shorter than one char each; recompute against the replaced text
    i = 0
    n = len(text)
    line_has_text = False
    pending_space: int | None = None
    while i < n:
        ch = text[i]
        if ch == "\n":
            if line_has_text:
                out.append("\n")
                mapping.append(i)
            line_has_text = False
            pending_space = None
        elif ch in " \t  \u200b":
            if line_has_text and pending_space is None:
                pending_space = i
        else:
            if pending_space is not None:
                out.append(" ")
                mapping.append(pending_space)
                pending_space = None
            out.append(ch)
            mapping.append(i)
            line_has_text = True
        i += 1
    while out and out[-1] == "\n":
        out.pop()
        mapping.pop()
    return "".join(out), mapping


def _join_wrapped_lines(text: str, mapping: list[int]) -> tuple[str, list[int]]:
    """Turn a line break into a space when the next line continues the same sentence."""
    out: list[str] = []
    out_map: list[int] = []
    for i, ch in enumerate(text):
        if ch == "\n" and 0 < i < len(text) - 1:
            prev, nxt = text[i - 1], text[i + 1]
            continues = prev in CONTINUATION_PREV or (prev not in TERMINALS + ":" and nxt.islower())
            if continues:
                out.append(" ")
                out_map.append(mapping[i])
                continue
        out.append(ch)
        out_map.append(mapping[i])
    return "".join(out), out_map


def normalise(raw: str) -> tuple[str, list[int]]:
    """Return (normalised text, offset map: normalised index -> index in raw)."""
    text, mapping = _collapse_whitespace(raw)
    return _join_wrapped_lines(text, mapping)


def _is_boundary(text: str, i: int, sentence_start: int) -> bool:
    """True if the terminal punctuation at text[i] ends a sentence."""
    ch = text[i]
    j = i + 1
    if j >= len(text):
        return True
    if text[j] == "\n":
        return True
    if text[j] != " ":
        return False  # decimals (3.5), e.g., "mm.)" and similar
    k = j
    while k < len(text) and text[k] == " ":
        k += 1
    if k >= len(text):
        return True
    nxt = text[k]
    if not (nxt.isupper() or nxt.isdigit() or nxt in "(\"'["):
        return False  # sentence continues in lower case: "9 mm. in the lower lobe"
    if ch == ".":
        before = text[sentence_start : i + 1].strip()
        if re.fullmatch(r"\d{1,2}\.", before):
            return False  # list numbering: "1. Pulmonary nodule"
        token = re.search(r"([A-Za-z.]+)\.$", text[sentence_start : i + 1])
        if token and token.group(1).lower() in ABBREVIATIONS:
            return False
    return True


def split_sentences(norm: str, mapping: list[int], raw: str, line_pages: list[int | None] | None) -> list[Sentence]:
    sentences: list[Sentence] = []
    start = 0
    n = len(norm)

    def emit(a: int, b: int) -> None:
        while a < b and norm[a] == " ":
            a += 1
        while b > a and norm[b - 1] in " \n":
            b -= 1
        if a >= b:
            return
        src_start, src_end = mapping[a], mapping[b - 1] + 1
        line = raw.count("\n", 0, src_start) + 1
        page = line_pages[line - 1] if line_pages and line - 1 < len(line_pages) else None
        sentences.append(
            Sentence(f"s{len(sentences) + 1:03d}", norm[a:b], a, b, src_start, src_end, line, page)
        )

    i = 0
    while i < n:
        ch = norm[i]
        if ch == "\n":
            emit(start, i)
            start = i + 1
        elif ch in TERMINALS and _is_boundary(norm, i, start):
            emit(start, i + 1)
            start = i + 1
        i += 1
    emit(start, n)
    return sentences


def read_text(text: str) -> ReportText:
    if len(text) > MAX_TEXT_CHARS:
        raise ReportReadError("The report text is longer than 100,000 characters.")
    return _build(text, None)


def read_pdf(data: bytes) -> ReportText:
    text, pages = pdf_to_text(data)
    return _build(text, pages)


def _build(raw: str, pages: list[int | None] | None) -> ReportText:
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    norm, mapping = normalise(raw)
    if not norm.strip():
        raise ReportReadError("The report text is empty.")
    return ReportText(raw=raw, normalised=norm, sentences=split_sentences(norm, mapping, raw, pages))
