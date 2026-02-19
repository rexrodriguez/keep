"""
SHARP model wrapper.
Loads the model once on startup, then on each call:
  1. Decodes the JPEG, runs SHARP, extracts Gaussian mean_vectors as a point cloud.
  2. Transforms from SHARP camera space (OpenCV: x-right, y-down, z-forward) to
     WebXR world space using the supplied camera-to-world matrix (column-major).
Returns an (N, 3) numpy array of world-space 3D points in meters.
"""

from __future__ import annotations

import base64
import io
import logging
from typing import Optional

import numpy as np
import torch
from PIL import Image

logger = logging.getLogger(__name__)

# Module-level model singleton — loaded lazily on first call.
_predictor = None


def _load_model():
    global _predictor
    if _predictor is not None:
        return _predictor

    logger.info("Loading SHARP model (weights download on first run)…")
    from sharp.models.predictor import create_predictor  # type: ignore
    from sharp.models.params import PredictorParams  # type: ignore

    params = PredictorParams()
    _predictor = create_predictor(params)
    # Switch to inference mode (disables dropout/batchnorm training behaviour)
    _predictor.train(mode=False)
    logger.info("SHARP model ready.")
    return _predictor


def get_points_world(
    image_b64: str,
    view_matrix_c2w_col_major: list[float],
) -> Optional[np.ndarray]:
    """
    Run SHARP on a JPEG image and return world-space 3D point cloud.

    Parameters
    ----------
    image_b64 : str
        Raw base64 JPEG bytes (no data-URL prefix).
    view_matrix_c2w_col_major : list[float]
        16-element column-major camera-to-world matrix from WebXR
        (view.transform.matrix).  WebXR convention: Y-up, Z-back, right-handed.

    Returns
    -------
    np.ndarray of shape (N, 3) in meters, world space, or None on failure.
    """
    try:
        predictor = _load_model()
    except Exception as exc:
        logger.error("Failed to load SHARP: %s", exc)
        return None

    # --- Decode image -------------------------------------------------------
    img_bytes = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    orig_w, orig_h = img.size

    # --- Disparity factor (focal / width) -----------------------------------
    # Without EXIF, estimate focal length as 0.8 x max(W, H) in pixels.
    focal_px_estimate = max(orig_w, orig_h) * 0.8
    disparity_factor = torch.tensor(focal_px_estimate / orig_w, dtype=torch.float32)

    # --- Preprocess ---------------------------------------------------------
    import torchvision.transforms.functional as TF  # type: ignore
    img_t = TF.to_tensor(img).unsqueeze(0)  # (1, 3, H, W), float32 in [0, 1]

    # --- Inference ----------------------------------------------------------
    device = "cuda" if torch.cuda.is_available() else "cpu"
    predictor.to(device)
    img_t = img_t.to(device)
    disparity_factor = disparity_factor.to(device)

    with torch.no_grad():
        gaussians_ndc = predictor(img_t, disparity_factor)

    # --- Unproject to metric camera space -----------------------------------
    from sharp.utils.gaussians import unproject_gaussians  # type: ignore

    intrinsics = torch.eye(4, device=device)
    internal_shape = (1536, 1536)
    gaussians = unproject_gaussians(
        gaussians_ndc,
        torch.eye(4, device=device),
        intrinsics,
        internal_shape,
    )

    # mean_vectors: (1, N, 3) in SHARP camera space
    #   SHARP convention (OpenCV): x-right, y-down, z-forward
    pts_cam_sharp = gaussians.mean_vectors[0].cpu().numpy()  # (N, 3)

    # --- Convert SHARP camera space to WebXR camera space -------------------
    # WebXR: x-right, y-up, z-back  →  flip y and z
    pts_cam_xr = pts_cam_sharp * np.array([1.0, -1.0, -1.0], dtype=np.float64)

    # --- Apply c2w to get world space ---------------------------------------
    # WebXR column-major layout: reshape with order='F'
    c2w = np.array(view_matrix_c2w_col_major, dtype=np.float64).reshape(4, 4, order="F")

    ones = np.ones((pts_cam_xr.shape[0], 1), dtype=np.float64)
    pts_h = np.hstack([pts_cam_xr, ones])         # (N, 4)
    pts_world = (c2w @ pts_h.T).T[:, :3]          # (N, 3)

    return pts_world
