"""
SHARP model wrapper.
Loads the model once on startup, then on each call:
  1. Decodes the JPEG, runs SHARP, extracts Gaussian mean_vectors as a point cloud.
  2. Transforms from SHARP camera space (OpenCV: x-right, y-down, z-forward) to
     WebXR world space using the supplied camera-to-world matrix (column-major).
Returns a dict with world-space points, camera-space points, intrinsics, and decoded image.
"""

from __future__ import annotations

import base64
import io
import logging
from typing import Optional

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

logger = logging.getLogger(__name__)

DEFAULT_MODEL_URL = "https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt"
INTERNAL_SHAPE = (1536, 1536)

# Module-level model singleton — loaded lazily on first call.
_predictor = None
_device = None


def _load_model():
    global _predictor, _device
    if _predictor is not None:
        return _predictor

    logger.info("Loading SHARP model (weights download on first run)...")

    from sharp.models import create_predictor, PredictorParams  # type: ignore

    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Using device %s", _device)

    state_dict = torch.hub.load_state_dict_from_url(DEFAULT_MODEL_URL, progress=True)
    _predictor = create_predictor(PredictorParams())
    _predictor.load_state_dict(state_dict)
    _predictor.train(mode=False)
    _predictor.to(_device)

    logger.info("SHARP model ready.")
    return _predictor


def get_points_world(
    image_b64: str,
    view_matrix_c2w_col_major: list[float],
    proj_matrix_col_major: Optional[list[float]] = None,
) -> Optional[dict]:
    """
    Run SHARP on a JPEG image and return 3D point cloud data.

    Returns a dict with:
      pts_world:     (N, 3) world-space points in meters
      pts_cam_sharp: (N, 3) camera-space points (OpenCV convention)
      f_px:          focal length in pixels (for 2D re-projection)
      img_width:     original image width
      img_height:    original image height
      image_np:      (H, W, 3) uint8 decoded image (reusable by SAM)
    """
    try:
        predictor = _load_model()
    except Exception as exc:
        logger.error("Failed to load SHARP: %s", exc)
        return None

    device = _device

    # --- Decode image -------------------------------------------------------
    img_bytes = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img_np = np.array(img)
    height, width = img_np.shape[:2]

    # --- Focal length from projection matrix or estimate --------------------
    if proj_matrix_col_major is not None:
        P = np.array(proj_matrix_col_major, dtype=np.float64).reshape(4, 4, order="F")
        f_px = float(P[0, 0]) * width / 2.0
        logger.info("Focal length from projection matrix: %.1f px (P[0,0]=%.4f, width=%d)", f_px, P[0, 0], width)
    else:
        f_px = max(width, height) * 0.8
        logger.info("Focal length estimated: %.1f px (fallback)", f_px)

    # --- Preprocess (match sharp.cli.predict.predict_image) -----------------
    image_pt = torch.from_numpy(img_np.copy()).float().to(device).permute(2, 0, 1) / 255.0
    disparity_factor = torch.tensor([f_px / width]).float().to(device)

    image_resized = F.interpolate(
        image_pt[None],
        size=(INTERNAL_SHAPE[1], INTERNAL_SHAPE[0]),
        mode="bilinear",
        align_corners=True,
    )

    # --- Inference ----------------------------------------------------------
    with torch.no_grad():
        gaussians_ndc = predictor(image_resized, disparity_factor)

    # --- Unproject to metric camera space -----------------------------------
    from sharp.utils.gaussians import unproject_gaussians  # type: ignore

    intrinsics = torch.tensor(
        [
            [f_px, 0, width / 2, 0],
            [0, f_px, height / 2, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ],
        dtype=torch.float32,
        device=device,
    )
    intrinsics_resized = intrinsics.clone()
    intrinsics_resized[0] *= INTERNAL_SHAPE[0] / width
    intrinsics_resized[1] *= INTERNAL_SHAPE[1] / height

    gaussians = unproject_gaussians(
        gaussians_ndc,
        torch.eye(4, device=device),
        intrinsics_resized,
        INTERNAL_SHAPE,
    )

    # mean_vectors: (1, N, 3) in SHARP camera space (OpenCV: x-right, y-down, z-forward)
    pts_cam_sharp = gaussians.mean_vectors[0].cpu().numpy()  # (N, 3)

    # --- Convert SHARP camera space to WebXR camera space -------------------
    # WebXR: x-right, y-up, z-back  ->  flip y and z
    pts_cam_xr = pts_cam_sharp * np.array([1.0, -1.0, -1.0], dtype=np.float64)

    # --- Apply c2w to get world space ---------------------------------------
    c2w = np.array(view_matrix_c2w_col_major, dtype=np.float64).reshape(4, 4, order="F")

    ones = np.ones((pts_cam_xr.shape[0], 1), dtype=np.float64)
    pts_h = np.hstack([pts_cam_xr, ones])         # (N, 4)
    pts_world = (c2w @ pts_h.T).T[:, :3]          # (N, 3)

    return {
        "pts_world": pts_world,
        "pts_cam_sharp": pts_cam_sharp,
        "f_px": f_px,
        "img_width": width,
        "img_height": height,
        "image_np": img_np,
    }
