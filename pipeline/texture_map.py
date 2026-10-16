"""Map LIDC texture ratings (1-5) to an attenuation class.

LIDC anchors: 1 = non-solid (ground-glass), 3 = part-solid (mixed), 5 = solid.
Rule (docs/build/02, step 4): median <= 2 -> ground-glass; median >= 4 -> solid; otherwise
part-solid (this covers 3 and the unanchored half-steps 2.5, 3.5). If radiologists disagree
by more than 2 points the attenuation is flagged uncertain.
"""

from __future__ import annotations

import statistics

ATTENUATION_METHOD = (
    "median of the LIDC texture ratings from the radiologists: <=2 ground-glass, >=4 solid, "
    "otherwise part-solid; uncertain if ratings differ by more than 2 points"
)


def attenuation_from_ratings(ratings: list[int]) -> tuple[str, bool]:
    if not ratings:
        raise ValueError("no texture ratings")
    median = statistics.median(ratings)
    if median <= 2:
        label = "ground-glass"
    elif median >= 4:
        label = "solid"
    else:
        label = "part-solid"
    uncertain = (max(ratings) - min(ratings)) > 2
    return label, uncertain
