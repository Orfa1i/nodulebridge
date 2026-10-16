"""Team-written example reports, generated from the manifest so no value is hard-coded.

LIDC-IDRI has no radiology reports. Each report is labelled as an example, and its age and
history are fictional (labelled). Size, attenuation and lobe come from the manifest. No risk
level is written: radiologists do not state one, and the doctor decides risk in the product.
All findings other than the measured nodule are fictional scenario text.

Cases A to C are the original three: their report text must never change (the cached model
extractions, the voice clips and the seed files are keyed on it; a test checks it). Cases D to T
are the extra studies of the worklist. Three of them (R, S, T) are deliberate "the guideline does
not apply" examples (stated age 30, a lung cancer screening scan, a known cancer), so the
guardrails can be shown on a real scan.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

NO_FRACTURE = ["No acute rib fracture is seen."]
CTPA_VESSELS = ["The pulmonary arteries are well opacified.", "No pulmonary embolism is seen."]
NODULE_ONLY = ["1. Pulmonary nodule, as described above."]


def _s(age, sex, exam, indication, history, source, *, chest_wall=None, vessels=None, airways=None, impression=None):
    return {
        "age": age,
        "sex": sex,
        "exam": exam,
        "indication": indication,
        "history": history,
        "source": source,  # who sent the study: a fictional scenario detail for the worklist
        "chest_wall": chest_wall or NO_FRACTURE,
        "vessels": vessels or [],
        "airways": airways or [],
        "impression": impression or NODULE_ONLY,
    }


NEVER = "Never smoker."
NO_CANCER = "No known cancer."

SCENARIOS = {
    "A": _s(58, "male", "CT chest, emergency department", "Right rib pain after a fall.",
            ["Former smoker, quit 10 years ago.", NO_CANCER], "Emergency department",
            chest_wall=["There is a healing fracture of the right seventh rib, with early callus.", "The alignment is anatomical.", "No other acute rib fracture is seen."],
            impression=["1. Healing right seventh rib fracture.", "2. Pulmonary nodule, as described above."]),
    "B": _s(46, "female", "CT pulmonary angiogram", "Chest pain.", [NEVER, NO_CANCER], "Emergency department", vessels=CTPA_VESSELS),
    "C": _s(63, "male", "CT chest", "Persistent cough.", [NO_CANCER, "Not immunocompromised."], "Primary care",
            airways=["There is no endobronchial lesion.", "There is no mucus plugging."]),
    "D": _s(52, "female", "CT chest, emergency department", "Chest pain.", [NEVER, NO_CANCER], "Emergency department"),
    "E": _s(67, "male", "CT chest", "Chest tightness.", ["Current smoker, 30 pack-years.", NO_CANCER], "Outpatient chest clinic"),
    "F": _s(39, "female", "CT pulmonary angiogram", "Shortness of breath.", [NEVER, NO_CANCER], "Emergency department", vessels=CTPA_VESSELS),
    "G": _s(61, "male", "CT chest", "Hoarseness for six weeks.", ["Former smoker, quit 12 years ago.", NO_CANCER], "Ear, nose and throat clinic"),
    "H": _s(55, "female", "CT chest", "Weight loss without a clear cause.", [NEVER, NO_CANCER], "Primary care"),
    "I": _s(71, "male", "CT chest", "Shortness of breath on exertion.", ["Former smoker, quit 20 years ago.", NO_CANCER], "Cardiology clinic"),
    "J": _s(48, "female", "CT chest, emergency department", "Pain on breathing in.", [NEVER, NO_CANCER], "Emergency department"),
    "K": _s(59, "female", "CT chest", "Chronic cough.", ["Former smoker, quit 8 years ago.", NO_CANCER], "Primary care"),
    "L": _s(66, "male", "CT chest", "Assessment before hip surgery.", ["Former smoker, quit 15 years ago.", NO_CANCER], "Pre-operative clinic"),
    "M": _s(57, "female", "CT chest", "Dry cough for three months.", [NEVER, NO_CANCER], "Outpatient chest clinic"),
    "N": _s(69, "male", "CT chest, emergency department", "Chest pain after a road traffic collision.", ["Former smoker, quit 25 years ago.", NO_CANCER], "Emergency department"),
    "O": _s(44, "male", "CT pulmonary angiogram", "Sudden shortness of breath.", [NEVER, NO_CANCER], "Emergency department", vessels=CTPA_VESSELS),
    "P": _s(62, "female", "CT chest", "Coughing up a small amount of blood.", ["Former smoker, quit 5 years ago.", NO_CANCER], "Primary care"),
    "Q": _s(74, "female", "CT chest", "Breathlessness.", [NEVER, NO_CANCER], "Geriatric clinic"),
    # the guideline does not apply to these three: they show the guardrails on a real scan
    "R": _s(30, "male", "CT chest, emergency department", "Chest pain after a fall.", [NEVER, NO_CANCER], "Emergency department"),
    "S": _s(63, "male", "CT chest, lung cancer screening", "Lung cancer screening.", ["Current smoker, 40 pack-years.", NO_CANCER], "Screening programme"),
    "T": _s(68, "female", "CT chest", "Staging of a known colon cancer.", ["History of metastatic colon cancer.", "Not immunocompromised."], "Oncology clinic"),
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
    L += [("p", t) for t in sc["chest_wall"]]
    L += [
        ("p", "The sternum and the visualised thoracic spine are intact."),
        ("p", "The soft tissues of the chest wall are unremarkable."),
        ("h3", "Heart and vessels"),
    ]
    L += [("p", t) for t in sc["vessels"]]
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
    L += [("p", t) for t in sc["airways"]]
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
    L += [("p", t) for t in sc["impression"]]
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
