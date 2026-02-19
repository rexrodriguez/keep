"""
Geometric helpers:
  - unproject_ray: converts a JPEG-space pixel to a world-space ray.
  - filter_and_fit_box: filters a world-space point cloud to the object region
    and fits a gravity-aligned bounding box.
All matrices from WebXR are column-major (reshape with order='F').
"""

from __future__ import annotations

from typing import Optional, Tuple

import numpy as np


def unproject_ray(
    pixel_x: float,
    pixel_y: float,
    img_w: int,
    img_h: int,
    proj_col_major: list[float],
    c2w_col_major: list[float],
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Unproject a JPEG-space pixel to a world-space ray.

    Parameters
    ----------
    pixel_x, pixel_y : float
        Pixel coordinates in the JPEG image (origin = top-left).
    img_w, img_h : int
        JPEG image dimensions in pixels.
    proj_col_major : list[float]
        16-element column-major WebXR projection matrix.
    c2w_col_major : list[float]
        16-element column-major camera-to-world matrix.

    Returns
    -------
    origin_world : np.ndarray (3,)
    direction_world : np.ndarray (3,), unit length
    """
    P = np.array(proj_col_major, dtype=np.float64).reshape(4, 4, order="F")
    c2w = np.array(c2w_col_major, dtype=np.float64).reshape(4, 4, order="F")
    P_inv = np.linalg.inv(P)

    # Convert pixel to NDC.  WebXR clip space: x right, y up, z: -1=near, +1=far.
    x_ndc = (2.0 * pixel_x / img_w) - 1.0
    y_ndc = 1.0 - (2.0 * pixel_y / img_h)   # flip Y (image top-left → NDC y-up)

    def _unproject(z_ndc: float) -> np.ndarray:
        p = P_inv @ np.array([x_ndc, y_ndc, z_ndc, 1.0])
        return p[:3] / p[3]

    p_near_cam = _unproject(-1.0)
    p_far_cam  = _unproject(1.0)

    # Camera origin in world space
    cam_origin_h = c2w @ np.array([0.0, 0.0, 0.0, 1.0])
    origin_world = cam_origin_h[:3]

    # Direction: transform camera-space ray direction to world space
    ray_cam = p_far_cam - p_near_cam
    ray_world_h = c2w @ np.append(ray_cam, 0.0)
    direction_world = ray_world_h[:3]
    norm = np.linalg.norm(direction_world)
    if norm > 1e-9:
        direction_world /= norm

    return origin_world, direction_world


def ray_plane_intersect(
    origin: np.ndarray,
    direction: np.ndarray,
    plane_normal: np.ndarray,
    plane_point: np.ndarray,
) -> Optional[np.ndarray]:
    """
    Return world-space intersection of a ray with a plane, or None if parallel.
    """
    denom = float(np.dot(direction, plane_normal))
    if abs(denom) < 1e-9:
        return None
    t = float(np.dot(plane_point - origin, plane_normal)) / denom
    return origin + t * direction


def filter_and_fit_box(
    pts_world: np.ndarray,
    plane_normal: list[float],
    plane_point: list[float],
    tap_anchor: np.ndarray,
    radius_m: float = 1.0,
    floor_eps: float = 0.02,
    min_points: int = 50,
) -> Optional[Tuple[float, float, float]]:
    """
    Filter a world-space point cloud to the object region and fit a
    gravity-aligned bounding box.

    Parameters
    ----------
    pts_world : np.ndarray (N, 3)
    plane_normal : list[float]  [nx, ny, nz]
    plane_point  : list[float]  [px, py, pz]  — a point on the base plane
    tap_anchor   : np.ndarray (3,) — world-space point on the plane below the tap
    radius_m     : float — horizontal search radius around anchor
    floor_eps    : float — allow points slightly below the plane (sensor noise)
    min_points   : int — minimum points to attempt box fitting

    Returns
    -------
    (width_m, depth_m, height_m) or None if insufficient points.
    """
    n = np.array(plane_normal, dtype=np.float64)
    n /= np.linalg.norm(n)
    p0 = np.array(plane_point, dtype=np.float64)

    # Height above the base plane for each point
    above = pts_world @ n - float(np.dot(p0, n))

    # Horizontal (on-plane) distance from tap anchor
    pts_on_plane = pts_world - np.outer(above, n)
    horiz_dist = np.linalg.norm(pts_on_plane - tap_anchor, axis=1)

    mask = (above > -floor_eps) & (horiz_dist < radius_m)
    pts = pts_world[mask]

    if len(pts) < min_points:
        return None

    # --- Height ---
    heights = pts @ n - float(np.dot(p0, n))
    height_m = float(np.percentile(heights, 95))

    # --- Footprint extents on the base plane ---
    # Build two orthonormal basis vectors (u, v) spanning the plane
    ref = np.array([1.0, 0.0, 0.0]) if abs(n[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(n, ref)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)

    coords_u = (pts - p0) @ u
    coords_v = (pts - p0) @ v

    width_m = float(np.percentile(coords_u, 95) - np.percentile(coords_u, 5))
    depth_m = float(np.percentile(coords_v, 95) - np.percentile(coords_v, 5))

    return max(0.05, width_m), max(0.05, depth_m), max(0.05, height_m)
