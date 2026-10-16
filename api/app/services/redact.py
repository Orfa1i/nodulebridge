"""Pattern-based redaction of a report BEFORE it is sent to a language model.

This is regex matching and it is NOT complete: it misses names written in prose, unusual ID formats and anything in
another language. The demo uses example reports only; the UI says so. It exists to show the safe design (nothing
identifying goes to the model without the person seeing what was removed), not to make real reports safe.

What it matches (and nothing more, so clinical text such as sizes and dates of the scan is left alone):
- "Patient:", "Patient name:", "Name:" lines  -> the value after the colon;
- medical record, patient ID, accession and file numbers  -> the number;
- ID-like tokens such as ABC-1234567;
- phone numbers (nine or more digits, optionally with +, spaces, dashes, brackets);
- dates of birth after "DOB", "D.O.B." or "Date of birth";
- e-mail addresses.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MARKER = "[redacted]"

KIND_LABEL = {
    "name": "name",
    "id": "ID number",
    "phone": "phone number",
    "dob": "date of birth",
    "email": "e-mail address",
}

_NAME_LINE = re.compile(r"(?im)^(?P<head>[ \t]*(?:patient(?:[ \t]+name)?|name|pt)[ \t]*[:\-][ \t]*)(?P<value>[^\n]*\S[^\n]*)$")
# a "Patient:" line that only describes the patient (age, sex) carries clinical context, not a name: keep it
_CLINICAL_VALUE = re.compile(r"(?i)\b(?:\d{1,3}[- ]?(?:years?|yrs?)|y/?o|years?[ \t]+old|woman|man|male|female|girl|boy)\b")
_ID_LABELLED = re.compile(
    r"(?i)\b(?P<head>(?:mrn|medical[ \t]+record(?:[ \t]+(?:no\.?|number))?|patient[ \t]+id|pid|accession(?:[ \t]+(?:no\.?|number))?|file[ \t]+(?:no\.?|number))[ \t]*[:#]?[ \t]*)(?P<value>[A-Z0-9][A-Z0-9\-/]{3,})"
)
_ID_TOKEN = re.compile(r"\b[A-Z]{2,4}-\d{6,}\b")
_PHONE = re.compile(r"(?<![\w/])\+?\(?\d[\d \t().\-]{7,}\d(?![\w/])")
_DOB = re.compile(
    r"(?i)\b(?P<head>(?:d\.?o\.?b\.?|date[ \t]+of[ \t]+birth|born)[ \t]*[:\-]?[ \t]*)(?P<value>\d{1,2}[./\- ]\d{1,2}[./\- ]\d{2,4}|\d{4}[./\-]\d{1,2}[./\-]\d{1,2}|\d{1,2}[ \t]+[A-Za-z]{3,9}[ \t]+\d{4})"
)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")


@dataclass
class Redaction:
    text: str
    items: dict[str, int] = field(default_factory=dict)

    @property
    def total(self) -> int:
        return sum(self.items.values())

    def as_json(self) -> dict:
        return {
            "text": self.text,
            "total": self.total,
            "items": [{"kind": k, "label": KIND_LABEL[k], "count": n} for k, n in sorted(self.items.items())],
            "complete": False,  # always false: pattern matching cannot promise that
        }


def _digits(s: str) -> int:
    return sum(c.isdigit() for c in s)


def redact(text: str) -> Redaction:
    out = Redaction(text=text)

    def bump(kind: str) -> None:
        out.items[kind] = out.items.get(kind, 0) + 1

    def labelled(kind: str):
        def sub(m: re.Match[str]) -> str:
            if m.group("value").strip().lower() == MARKER or (kind == "name" and _CLINICAL_VALUE.search(m.group("value"))):
                return m.group(0)
            bump(kind)
            return f"{m.group('head')}{MARKER}"

        return sub

    t = _NAME_LINE.sub(labelled("name"), out.text)
    t = _ID_LABELLED.sub(labelled("id"), t)
    t = _DOB.sub(labelled("dob"), t)

    def token(kind: str, min_digits: int = 0):
        def sub(m: re.Match[str]) -> str:
            if min_digits and _digits(m.group(0)) < min_digits:
                return m.group(0)
            bump(kind)
            return MARKER

        return sub

    t = _ID_TOKEN.sub(token("id"), t)
    t = _EMAIL.sub(token("email"), t)
    t = _PHONE.sub(token("phone", 9), t)
    out.text = t
    return out
