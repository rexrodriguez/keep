"""
FastAPI server for SHARP-based geometric object measurement.

POST /estimate  — accepts the enriched payload from the WebXR client,
runs SHARP to produce a 3D point cloud, then fits a gravity-aligned
bounding box using the WebXR camera matrices and base-plane anchor.

Response shape is identical to the old GPT-4o estimate-dimensions route so
the Next.js client needs no changes beyond pointing SHARP_SERVER_URL here.
"""

from __future__ import annotations

import logging
from typing import List, Optional

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

from geometry import filter_and_fit_box, ray_plane_intersect, unproject_ray
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
    confidence: str
    objectDescription: str


class EstimateResponse(BaseModel):
    success: bool
    estimate: Optional[DimensionEstimate] = None
    error: Optional[str] = None


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

    # 1. Run SHARP to get world-space point cloud
    pts = get_points_world(
        req.imageJpegBase64,
        req.camera.viewMatrix_c2w_colMajor,
    )
    if pts is None or len(pts) == 0:
        return EstimateResponse(success=False, error="SHARP inference failed")

    logger.info("SHARP returned %d 3D points", len(pts))

    # 2. Unproject tap pixel to a world-space ray
    try:
        origin, direction = unproject_ray(
            req.selection.pixel.x,
            req.selection.pixel.y,
            req.imageSize.width,
            req.imageSize.height,
            req.camera.projectionMatrix_colMajor,
            req.camera.viewMatrix_c2w_colMajor,
        )
    except Exception as exc:
        return EstimateResponse(success=False, error=f"Ray unproject failed: {exc}")

    # 3. Intersect ray with base plane to get tap anchor on the floor
    plane_n = np.array(req.plane.normal_world, dtype=np.float64)
    plane_n /= np.linalg.norm(plane_n) + 1e-12
    plane_p = np.array(req.plane.point_world, dtype=np.float64)

    tap_anchor = ray_plane_intersect(origin, direction, plane_n, plane_p)
    if tap_anchor is None:
        # Ray is parallel to the plane — fall back to the stored hit world position
        tap_anchor = plane_p

    # 4. Filter point cloud to object region and fit bounding box
    result = filter_and_fit_box(
        pts,
        req.plane.normal_world,
        req.plane.point_world,
        tap_anchor,
    )

    if result is None:
        return EstimateResponse(
            success=False,
            error="Insufficient 3D points — tap closer to the object",
        )

    width_m, depth_m, height_m = result

    # 5. Confidence based on point count
    n_pts = len(pts)
    if n_pts > 10_000:
        confidence = "HIGH"
    elif n_pts > 2_000:
        confidence = "MEDIUM"
    else:
        confidence = "LOW"

    logger.info(
        "Fitted box: %.2f × %.2f × %.2f m  confidence=%s",
        width_m, depth_m, height_m, confidence,
    )

    return EstimateResponse(
        success=True,
        estimate=DimensionEstimate(
            width_cm=round(width_m * 100, 1),
            depth_cm=round(depth_m * 100, 1),
            height_cm=round(height_m * 100, 1),
            confidence=confidence,
            objectDescription="Geometric measurement via SHARP",
        ),
    )


@app.get("/health")
def health():
    return {"status": "ok"}
