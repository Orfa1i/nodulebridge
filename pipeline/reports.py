"""Team-written example reports, generated from the manifest so no value is hard-coded.

LIDC-IDRI has no radiology reports. Each report is labelled as an example, and its age and
history are fictional (labelled). Size, attenuation and lobe come from the manifest. No risk
level is written: radiologists do not state one, and the doctor decides risk in the product.
All findings other than the measured nodule are fictional scenario text.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

SCENARIOS = {
    "A": {
        "age": 58,
        "sex": "male",
        "exam": "CT chest, emergency department",
        "indication": "Right rib pain after a fall.",
        "history": ["Former smoker, quit 10 years ago.", "No known cancer."],
    },
    "B": {
        "age": 46,
        "sex": "female",
        "exam": "CT pulmonary angiogram",
        "indication": "Chest pain.",
        "history": ["Never smoker.", "No known cancer."],
    },
    "C": {
        "age": 63,
        "sex": "male",
        "exam": "CT chest",
        "indication": "Persistent cough.",
        "history": ["No known cancer.", "Not immunocompromised."],
    },
}

HEADER_FLAGS = (
    "Example report written for this demo. Not a real patient.",
    "Fictional age and history written for this demo.",
)


def _article(size_mm: int) -> str:
    s = str(size_mm)
    return "an" if s[0] == "8" or s in {"11", "18"} else "a"


def nodule_sentence(nodule: dict) -> str:
    size = nodule["fleischner_size_mm"]
    return (
        f"However, {_article(size)} {size} mm {nodule['attenuation']} nodule is seen in the "
        f"{nodule['lobe_estimate']['label']}."
    )


def build_lines(case: str, label: str, patient_id: str, nodule: dict, contrast: bool,
                thickness_mm: float | None) -> list[tuple[str, str]]:
    """Return (kind, text) lines; kind is h1, h2, h3 or p. One sentence per line."""
    sc = SCENARIOS[case]
    person = "man" if sc["sex"] == "male" else "woman"
    tech = "with" if contrast else "without"
    slices = f", {thickness_mm:g} mm slices" if thickness_mm else ""
    L: list[tuple[str, str]] = [
        ("h1", "Chest CT report"),
        ("p", HEADER_FLAGS[0]),
        ("p", HEADER_FLAGS[1]),
        ("p", f"{label} · {patient_id}"),
        ("h2", "Clinical information"),
        ("p", f"{sc['age']}-year-old {person}. {sc['exam']}. {sc['indication']}"),
        ("p", " ".join(sc["history"])),
        ("h2", "Technique"),
        ("p", f"Axial CT of the chest {tech} intravenous contrast{slices}."),
        ("p", "No prior imaging is available for comparison."),
        ("h2", "Findings"),
        ("h3", "Chest wall and bones"),
    ]
    if case == "A":
        L += [
            ("p", "There is a healing fracture of the right seventh rib, with early callus."),
            ("p", "The alignment is anatomical."),
            ("p", "No other acute rib fracture is seen."),
        ]
    else:
        L += [("p", "No acute rib fracture is seen.")]
    L += [
        ("p", "The sternum and the visualised thoracic spine are intact."),
        ("p", "The soft tissues of the chest wall are unremarkable."),
        ("h3", "Heart and vessels"),
    ]
    if case == "B":
        L += [
            ("p", "The pulmonary arteries are well opacified."),
            ("p", "No pulmonary embolism is seen."),
        ]
    L += [
        ("p", "The heart is normal in size."),
        ("p", "There is no pericardial effusion."),
        ("p", "The thoracic aorta is normal in calibre."),
        ("h3", "Mediastinum and hila"),
        ("p", "There is no mediastinal or hilar lymphadenopathy."),
        ("p", "The oesophagus is unremarkable."),
        ("h3", "Airways"),
        ("p", "The trachea and main bronchi are patent."),
    ]
    if case == "C":
        L += [
            ("p", "There is no endobronchial lesion."),
            ("p", "There is no mucus plugging."),
        ]
    L += [
        ("h3", "Lungs and pleura"),
        ("p", "The lungs are well expanded."),
        ("p", "There is no consolidation or pulmonary oedema."),
        ("p", "There is no pneumothorax."),
        ("p", "There is no pleural effusion."),
        ("p", nodule_sentence(nodule)),
        ("p", "No other pulmonary nodule is identified."),
        ("h3", "Upper abdomen"),
        ("p", "The visualised upper abdomen is unremarkable."),
        ("h2", "Impression"),
    ]
    if case == "A":
        L.append(("p", "1. Healing right seventh rib fracture."))
        L.append(("p", "2. Pulmonary nodule, as described above."))
    else:
        L.append(("p", "1. Pulmonary nodule, as described above."))
    return L


def to_markdown(lines: list[tuple[str, str]]) -> str:
    out: list[str] = []
    prefix = {"h1": "# ", "h2": "## ", "h3": "### ", "p": ""}
    for kind, text in lines:
        if kind == "p":
            out.append(f"{text}  ")  # two trailing spaces keep one sentence per line
        else:
            out.append("")
            out.append(f"{prefix[kind]}{text}")
            out.append("")
    return "\n".join(out).strip() + "\n"


def to_pdf(lines: list[tuple[str, str]], path: Path) -> None:
    ss = getSampleStyleSheet()
    styles = {
        "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontSize=18, spaceAfter=6),
        "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontSize=13, spaceBefore=10, spaceAfter=4),
        "h3": ParagraphStyle("h3", parent=ss["Heading3"], fontSize=11, spaceBefore=6, spaceAfter=2),
        "p": ParagraphStyle("p", parent=ss["BodyText"], fontSize=10.5, leading=14),
    }
    flow = []
    for kind, text in lines:
        safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        flow.append(Paragraph(safe, styles[kind]))
    doc = SimpleDocTemplate(
        str(path), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title="Example chest CT report (not a real patient)", author="NoduleBridge demo team",
    )
    flow.append(Spacer(1, 4))
    doc.build(flow)
