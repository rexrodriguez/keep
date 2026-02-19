"""
FastAPI server for SHARP-based geometric object measurement.

POST /estimate  — accepts the enriched payload from the WebXR client,
runs SHARP to produce a 3D point cloud, then fits a gravity-aligned
bounding box using the WebXR camera matrices and base-plane anchor.

Response shape is identical to the old GPT-4o estimate-dimensions route so
the Next.js client needs no changes beyond pointing SHARP_SERVER_URL here.
"""

from __future__ import annotations

import base64
import io
import logging
from typing import List, Optional

import numpy as np
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel

from geometry import filter_and_fit_box, filter_by_mask
from segmentation import get_object_mask
from sharp_runner import get_points_world

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SHARP Measurement Server")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class Pixel(BaseModel):
    x: float
    y: float


class ImageSize(BaseModel):
    width: int
    height: int


class Camera(BaseModel):
    viewMatrix_c2w_colMajor: List[float]
    projectionMatrix_colMajor: List[float]


class Plane(BaseModel):
    hitMatrix_colMajor: Optional[List[float]] = None
    normal_world: List[float]
    point_world: List[float]


class Selection(BaseModel):
    type: str
    pixel: Pixel


class EstimateRequest(BaseModel):
    imageJpegBase64: str
    imageSize: ImageSize
    camera: Camera
    plane: Plane
    selection: Selection


class DimensionEstimate(BaseModel):
    width_cm: float
    depth_cm: float
    height_cm: float
    rotation_deg: float = 0.0
    confidence: str
    objectDescription: str


class EstimateResponse(BaseModel):
    success: bool
    estimate: Optional[DimensionEstimate] = None
    error: Optional[str] = None
    maskImageBase64: Optional[str] = None


def _encode_mask_overlay(image_np: np.ndarray, mask: np.ndarray) -> str:
    """Encode SAM mask as a semi-transparent green overlay on the original image."""
    overlay = image_np.copy()
    overlay[mask] = (
        overlay[mask] * 0.4 + np.array([0, 255, 100], dtype=np.uint8) * 0.6
    ).astype(np.uint8)

    img = Image.fromarray(overlay)
    # Resize to keep response small
    max_w = 400
    if img.width > max_w:
        scale = max_w / img.width
        img = img.resize((max_w, int(img.height * scale)), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.post("/estimate", response_model=EstimateResponse)
def estimate(req: EstimateRequest) -> EstimateResponse:
    logger.info(
        "Received estimate request — image %dx%d, tap pixel (%.1f, %.1f)",
        req.imageSize.width,
        req.imageSize.height,
        req.selection.pixel.x,
        req.selection.pixel.y,
    )

    # 1. Run SHARP → full-scene 3D point cloud + camera-space points
    sharp_result = get_points_world(
        req.imageJpegBase64,
        req.camera.viewMatrix_c2w_colMajor,
        proj_matrix_col_major=req.camera.projectionMatrix_colMajor,
    )
    if sharp_result is None:
        return EstimateResponse(success=False, error="SHARP inference failed")

    logger.info(
        "SHARP returned %d 3D points, decoded image=%dx%d, f_px=%.1f",
        len(sharp_result["pts_world"]),
        sharp_result["img_width"],
        sharp_result["img_height"],
        sharp_result["f_px"],
    )

    # 2. Run SAM2 → object mask at tap pixel
    #    Tap pixel coords from client vs decoded JPEG dims:
    logger.info(
        "Tap pixel=(%.1f, %.1f) vs JPEG image=%dx%d vs client imageSize=%dx%d",
        req.selection.pixel.x, req.selection.pixel.y,
        sharp_result["img_width"], sharp_result["img_height"],
        req.imageSize.width, req.imageSize.height,
    )
    mask = get_object_mask(
        sharp_result["image_np"],
        req.selection.pixel.x,
        req.selection.pixel.y,
    )
    if mask is None:
        return EstimateResponse(success=False, error="SAM segmentation failed")

    # Encode mask overlay for client debug visualization
    mask_b64 = _encode_mask_overlay(sharp_result["image_np"], mask)

    # 3. Filter 3D points by SAM mask (project camera-space → 2D, lookup mask)
    pts_masked = filter_by_mask(
        sharp_result["pts_world"],
        sharp_result["pts_cam_sharp"],
        sharp_result["f_px"],
        sharp_result["img_width"],
        sharp_result["img_height"],
        mask,
    )

    if len(pts_masked) < 50:
        return EstimateResponse(
            success=False,
            error="Insufficient 3D points in object mask — tap closer to the object",
            maskImageBase64=mask_b64,
        )

    # 4. Oriented bounding box fit
    result = filter_and_fit_box(
        pts_masked,
        req.plane.normal_world,
        req.plane.point_world,
    )

    if result is None:
        return EstimateResponse(
            success=False,
            error="Could not fit bounding box — try tapping closer",
            maskImageBase64=mask_b64,
        )

    width_m, depth_m, height_m, rotation_deg = result

    # 5. Confidence based on masked point count
    n_pts = len(pts_masked)
    if n_pts > 5_000:
        confidence = "HIGH"
    elif n_pts > 1_000:
        confidence = "MEDIUM"
    else:
        confidence = "LOW"

    logger.info(
        "Fitted box: %.2f × %.2f × %.2f m  rot=%.1f°  (%d masked pts, confidence=%s)",
        width_m, depth_m, height_m, rotation_deg, n_pts, confidence,
    )

    return EstimateResponse(
        success=True,
        estimate=DimensionEstimate(
            width_cm=round(width_m * 100, 1),
            depth_cm=round(depth_m * 100, 1),
            height_cm=round(height_m * 100, 1),
            rotation_deg=round(rotation_deg, 1),
            confidence=confidence,
            objectDescription="Geometric measurement via SHARP + SAM",
        ),
        maskImageBase64=mask_b64,
    )


@app.get("/health")
def health():
    return {"status": "ok"}
