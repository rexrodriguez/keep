"""
Geometric helpers:
  - unproject_ray: converts a JPEG-space pixel to a world-space ray.
  - filter_and_fit_box: filters a world-space point cloud to the object region
    and fits a gravity-aligned bounding box.
All matrices from WebXR are column-major (reshape with order='F').
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


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
    y_ndc = 1.0 - (2.0 * pixel_y / img_h)   # flip Y (image top-left -> NDC y-up)

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


def project_to_pixels(
    pts_cam_sharp: np.ndarray,
    f_px: float,
    width: int,
    height: int,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Project SHARP camera-space (OpenCV) points to 2D pixel coordinates.

    Parameters
    ----------
    pts_cam_sharp : (N, 3) in SHARP/OpenCV camera space (x-right, y-down, z-forward)
    f_px : focal length in pixels
    width, height : original image dimensions

    Returns
    -------
    u, v : (N,) pixel coordinates
    valid : (N,) bool mask for points in front of camera
    """
    x, y, z = pts_cam_sharp[:, 0], pts_cam_sharp[:, 1], pts_cam_sharp[:, 2]
    valid = z > 0.01
    u = np.where(valid, x / z * f_px + width / 2, -1.0)
    v = np.where(valid, y / z * f_px + height / 2, -1.0)
    return u, v, valid


def filter_by_mask(
    pts_world: np.ndarray,
    pts_cam_sharp: np.ndarray,
    f_px: float,
    img_w: int,
    img_h: int,
    mask: np.ndarray,
) -> np.ndarray:
    """
    Keep only world-space points whose 2D projection falls inside the SAM mask,
    then apply depth clustering to reject background points that project into
    the same 2D silhouette as the object.

    Parameters
    ----------
    pts_world : (N, 3) world-space points
    pts_cam_sharp : (N, 3) SHARP/OpenCV camera-space points
    f_px : focal length in pixels
    img_w, img_h : image dimensions
    mask : (H, W) bool mask from SAM

    Returns
    -------
    (M, 3) filtered world-space points
    """
    u, v, valid = project_to_pixels(pts_cam_sharp, f_px, img_w, img_h)

    n_valid = int(valid.sum())
    logger.info(
        "Projection: %d / %d pts in front of camera (z > 0.01)",
        n_valid, len(pts_world),
    )

    if n_valid > 0:
        u_valid, v_valid = u[valid], v[valid]
        logger.info(
            "Projected pixel ranges: u=[%.1f, %.1f], v=[%.1f, %.1f] (image=%dx%d)",
            float(u_valid.min()), float(u_valid.max()),
            float(v_valid.min()), float(v_valid.max()),
            img_w, img_h,
        )

    iu = np.clip(u.astype(int), 0, img_w - 1)
    iv = np.clip(v.astype(int), 0, img_h - 1)

    in_mask = valid & mask[iv, iu]
    n_in = int(in_mask.sum())
    logger.info(
        "After 2D mask: %d / %d points (%.1f%%)",
        n_in, len(pts_world), 100.0 * n_in / max(len(pts_world), 1),
    )

    if n_in == 0:
        return pts_world[in_mask]

    # --- Depth clustering: reject background behind the object ---------------
    # Use camera-space z (depth) of masked points to find the object cluster.
    # The object forms a tight depth band; background is further away.
    depths = pts_cam_sharp[in_mask, 2]  # z values of masked points
    d_median = float(np.median(depths))
    d_iqr = float(np.percentile(depths, 75) - np.percentile(depths, 25))
    # Allow 1.5x IQR around median, but at least ±0.15m for thin objects
    d_margin = max(d_iqr * 1.5, 0.15)
    d_lo = d_median - d_margin
    d_hi = d_median + d_margin

    # Apply depth filter on the already-masked indices
    masked_idx = np.where(in_mask)[0]
    depth_ok = (pts_cam_sharp[masked_idx, 2] >= d_lo) & (pts_cam_sharp[masked_idx, 2] <= d_hi)
    final_idx = masked_idx[depth_ok]

    logger.info(
        "Depth cluster: median=%.3f, margin=%.3f [%.3f, %.3f] → %d / %d masked pts kept",
        d_median, d_margin, d_lo, d_hi, len(final_idx), n_in,
    )

    return pts_world[final_idx]


def filter_and_fit_box(
    pts_world: np.ndarray,
    plane_normal: list[float],
    plane_point: list[float],
    min_points: int = 50,
) -> Optional[Tuple[float, float, float, float]]:
    """
    Fit an oriented bounding box to a SAM-masked point cloud.

    Uses the plane normal as the "up" direction and PCA on the floor-plane
    projection to orient the box along the object's principal axes.

    Returns (width_m, depth_m, height_m, rotation_deg) or None.
    rotation_deg is the angle (degrees) of the object's long axis relative
    to the world X-axis, projected onto the floor plane.
    """
    if len(pts_world) < min_points:
        logger.warning("Insufficient points for box fit: %d < %d", len(pts_world), min_points)
        return None

    n = np.array(plane_normal, dtype=np.float64)
    n /= np.linalg.norm(n)

    # Height along gravity axis (point cloud's own extent)
    heights = pts_world @ n
    h_min = float(np.percentile(heights, 3))
    h_max = float(np.percentile(heights, 97))
    height_m = h_max - h_min

    logger.info(
        "Box fit: %d pts, height along normal: [%.3f, %.3f] → %.3f m",
        len(pts_world), h_min, h_max, height_m,
    )

    # Project points onto the floor plane (remove height component)
    centroid = pts_world.mean(axis=0)
    pts_centered = pts_world - centroid
    pts_flat = pts_centered - np.outer(pts_centered @ n, n)  # remove normal component

    # PCA on 2D footprint to find object's principal axes
    cov = np.cov(pts_flat.T)  # 3x3 covariance
    eigvals, eigvecs = np.linalg.eigh(cov)
    # eigh returns ascending order; last two are the two largest (floor-plane axes)
    # The smallest eigenvalue corresponds to the normal direction
    # Sort by eigenvalue descending
    order = np.argsort(eigvals)[::-1]
    eigvecs = eigvecs[:, order]

    # First two eigenvectors are the principal floor-plane axes
    u = eigvecs[:, 0]
    v = eigvecs[:, 1]

    # Ensure u and v are actually in the floor plane (orthogonal to n)
    u = u - np.dot(u, n) * n
    u /= np.linalg.norm(u) + 1e-12
    v = np.cross(n, u)
    v /= np.linalg.norm(v) + 1e-12

    coords_u = pts_centered @ u
    coords_v = pts_centered @ v

    extent_u = float(np.percentile(coords_u, 97) - np.percentile(coords_u, 3))
    extent_v = float(np.percentile(coords_v, 97) - np.percentile(coords_v, 3))

    # width = larger footprint axis, depth = smaller
    width_m = max(extent_u, extent_v)
    depth_m = min(extent_u, extent_v)

    # Rotation angle: angle of the longer axis relative to world X on the floor
    long_axis = u if extent_u >= extent_v else v
    # Project long_axis onto world X-Z plane (floor plane when normal=[0,1,0])
    rot_deg = float(np.degrees(np.arctan2(long_axis[2], long_axis[0])))

    logger.info(
        "Fitted extents: width=%.3f depth=%.3f height=%.3f rot=%.1f° (from %d pts)",
        width_m, depth_m, height_m, rot_deg, len(pts_world),
    )

    return (
        max(0.05, width_m),
        max(0.05, depth_m),
        max(0.05, height_m),
        rot_deg,
    )
