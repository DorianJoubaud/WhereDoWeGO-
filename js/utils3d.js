// === utils3d.js ===
const EARTH_RADIUS = 6371000; // meters
const toRadians = deg => deg * Math.PI / 180;
const toDegrees = rad => rad * 180 / Math.PI;


let convexHullVisible = false;
let convexHullMarkers = [];
let convexHullPolygon = null;


function toggleConvexHullMarkers(map, pointsLatLon) {
  if (convexHullVisible) {
    convexHullMarkers.forEach(m => map.removeLayer(m));
    if (convexHullPolygon) map.removeLayer(convexHullPolygon);
    convexHullMarkers = [];
    convexHullPolygon = null;
    convexHullVisible = false;
    return;
  }

  const points3D = pointsLatLon.map(p => latLonToXYZ(p.lat, p.lng));
  const projected = projectTo2D([0, 0, 1], points3D);
  const convexPoints = convexHull2D(projected);

  const latlngs = convexPoints.map(p3d => {
    const { lat, lng } = xyzToLatLon(...p3d);
    return [lat, lng];
  });

  // Polygone bleu clair (surface)
  convexHullPolygon = L.polygon(latlngs, {
    color: 'blue',
    fillColor: 'blue',
    fillOpacity: 0.2,
    weight: 2
  }).addTo(map);

  // Sommets visibles
  convexHullMarkers = latlngs.map(latlng => {
    return L.circleMarker(latlng, {
      color: 'blue',
      radius: 5,
      fillColor: 'blue',
      fillOpacity: 0.9
    }).addTo(map);
  });

  convexHullVisible = true;
}


function latLonToXYZ(lat, lon) {
  const latRad = toRadians(lat);
  const lonRad = toRadians(lon);
  const x = Math.cos(latRad) * Math.cos(lonRad);
  const y = Math.cos(latRad) * Math.sin(lonRad);
  const z = Math.sin(latRad);
  return [x, y, z];
}

function xyzToLatLon(x, y, z) {
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);
  const lon = Math.atan2(y, x);
  return { lat: toDegrees(lat), lng: toDegrees(lon) };
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function normalize(v) {
  const norm = Math.sqrt(dot(v, v));
  return [v[0] / norm, v[1] / norm, v[2] / norm];
}

function angleBetween(a, b) {
  return Math.acos(Math.min(1, Math.max(-1, dot(normalize(a), normalize(b)))));
}

function midPointOnSphere(a, b) {
  return normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
}

function circumcenterOnSphere(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = normalize(cross(ab, ac));

  const center = normalize(normal);
  if (dot(center, a) < 0) return [-center[0], -center[1], -center[2]];
  return center;
}

// === Convex Hull Projection ===
function projectTo2D(base, points3D) {
  const z = normalize(base);
  const x = normalize(cross([0, 0, 1], z));
  const y = cross(z, x);
  return points3D.map(p => {
    const dx = dot(p, x);
    const dy = dot(p, y);
    return { dx, dy, original: p };
  });
}

function convexHull2D(points2D) {
  points2D.sort((a, b) => a.dx - b.dx || a.dy - b.dy);
  const cross2D = (o, a, b) => (a.dx - o.dx) * (b.dy - o.dy) - (a.dy - o.dy) * (b.dx - o.dx);
  const lower = [];
  for (let p of points2D) {
    while (lower.length >= 2 && cross2D(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = points2D.length - 1; i >= 0; i--) {
    let p = points2D[i];
    while (upper.length >= 2 && cross2D(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...new Set([...lower, ...upper])].map(p => p.original);
}

function toggleConvexHullMarkers(map, pointsLatLon) {
  if (convexHullVisible) {
    convexHullMarkers.forEach(m => map.removeLayer(m));
    convexHullMarkers = [];
    convexHullVisible = false;
    return;
  }

  const points3D = pointsLatLon.map(p => latLonToXYZ(p.lat, p.lng));
  const projected = projectTo2D([0, 0, 1], points3D);
  const convexPoints = convexHull2D(projected);

  convexHullMarkers = convexPoints.map(p3d => {
    const { lat, lng } = xyzToLatLon(...p3d);
    return L.circleMarker([lat, lng], {
      color: 'blue',
      radius: 6,
      fillColor: 'blue',
      fillOpacity: 0.8
    }).addTo(map);
  });

  convexHullVisible = true;
}

function computeMinimumEnclosingCircle3D(pointsLatLon) {
  if (pointsLatLon.length === 0) return null;

  const points3D = pointsLatLon.map(p => latLonToXYZ(p.lat, p.lng));
  const projected = projectTo2D([0, 0, 1], points3D);
  const convexPoints = convexHull2D(projected);

  let best = null;

  // Try all triplets first (on convex hull)
  for (let i = 0; i < convexPoints.length; i++) {
    for (let j = i + 1; j < convexPoints.length; j++) {
      for (let k = j + 1; k < convexPoints.length; k++) {
        const A = normalize(convexPoints[i]);
        const B = normalize(convexPoints[j]);
        const C = normalize(convexPoints[k]);

        const center = circumcenterOnSphere(A, B, C);
        const radius = angleBetween(center, A);

        const containsAll = points3D.every(p => angleBetween(center, p) <= radius + 1e-10);
        if (containsAll && (!best || radius < best.radius)) {
          best = { center, radius };
        }
      }
    }
  }

  // Then try all pairs (on convex hull)
  for (let i = 0; i < convexPoints.length; i++) {
    for (let j = i + 1; j < convexPoints.length; j++) {
      const A = convexPoints[i];
      const B = convexPoints[j];
      const center = midPointOnSphere(A, B);
      const radius = Math.max(...points3D.map(p => angleBetween(center, p)));

      const containsAll = points3D.every(p => angleBetween(center, p) <= radius + 1e-10);
      if (containsAll && (!best || radius < best.radius)) {
        best = { center, radius };
      }
    }
  }

  if (!best) return null;

  const latlon = xyzToLatLon(...best.center);
  const refVec = points3D.find(p => Math.abs(angleBetween(best.center, p) - best.radius) < 1e-6) || points3D[0];
  const refLatLon = xyzToLatLon(...refVec);
  const radius = haversine(latlon.lat, latlon.lng, refLatLon.lat, refLatLon.lng);

  return {
    center: latlon,
    radius: radius
  };
}



