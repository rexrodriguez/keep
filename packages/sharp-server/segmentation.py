"""
SAM2 object segmentation with point-prompt.

Given an image and a tap pixel, returns a binary mask of the tapped object.
Model loaded lazily on first call (weights auto-download from Hugging Face).
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import torch
from scipy import ndimage

logger = logging.getLogger(__name__)

_predictor = None


def _load_sam():
    global _predictor
    if _predictor is not None:
        return _predictor

    logger.info("Loading SAM2 model (weights download on first run)...")
    from sam2.sam2_image_predictor import SAM2ImagePredictor  # type: ignore

    _predictor = SAM2ImagePredictor.from_pretrained("facebook/sam2-hiera-small")
    logger.info("SAM2 model ready.")
    return _predictor


def get_object_mask(
    image_np: np.ndarray,
    tap_x: float,
    tap_y: float,
) -> Optional[np.ndarray]:
    """
    Segment the object at the tap point.

    Parameters
    ----------
    image_np : np.ndarray (H, W, 3) uint8 RGB
    tap_x, tap_y : float
        Pixel coordinates of the user's tap (top-left origin, image-space).

    Returns
    -------
    np.ndarray (H, W) bool mask, or None on failure.
    """
    try:
        predictor = _load_sam()
    except Exception as exc:
        logger.error("Failed to load SAM2: %s", exc)
        return None

    try:
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            predictor.set_image(image_np)
            masks, scores, _ = predictor.predict(
                point_coords=np.array([[tap_x, tap_y]]),
                point_labels=np.array([1]),  # 1 = foreground
                multimask_output=True,
            )

        # masks: (3, H, W) — may be torch tensor; convert to numpy bool
        if isinstance(masks, torch.Tensor):
            masks = masks.cpu().numpy()
        if isinstance(scores, torch.Tensor):
            scores = scores.cpu().numpy()
        best = int(np.argmax(scores))
        mask = masks[best].astype(bool)
        n_raw = int(mask.sum())
        logger.info(
            "SAM raw mask: %d pixels (%.1f%% of image), score=%.3f",
            n_raw, 100.0 * n_raw / mask.size, float(scores[best]),
        )

        # Morphological closing to fill holes from transparent/mesh materials.
        # Kernel size scales with image — roughly 1% of the shorter dimension.
        k = max(5, min(mask.shape) // 100)
        if k % 2 == 0:
            k += 1
        struct = ndimage.generate_binary_structure(2, 1)
        mask = ndimage.binary_closing(mask, structure=struct, iterations=k // 2)
        # Fill any remaining interior holes
        mask = ndimage.binary_fill_holes(mask)

        n_filled = int(mask.sum())
        if n_filled != n_raw:
            logger.info("Mask after closing + fill: %d pixels (+%d)", n_filled, n_filled - n_raw)

        return mask

    except Exception as exc:
        logger.error("SAM2 inference failed: %s", exc)
        return None
