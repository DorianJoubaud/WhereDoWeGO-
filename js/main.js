// === main.js — WhereDoWeGo, dark-glass redesign ===
console.log('%c[WhereDoWeGo] main.js build v4 (timeout+urlencoded)', 'color:#11ABB0');

const map = L.map('map', { zoomControl: true }).setView([48.8566, 2.3522], 13);

// CartoDB Positron — clean light basemap that pairs with the dark UI
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

let points = [];
let markers = [];
let circleLayer = null;
let centerMarker = null;
let businessMarker = null;
let addingFromMap = false;

const $ = id => document.getElementById(id);
const toast = (msg, ms = 2500) => {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms);
};

// ---------- Geocoder (direct Nominatim fetch) ----------

async function geocodeAndAdd(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=fr&limit=1&q=${encodeURIComponent(query)}`;
    try {
        const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
        const data = await res.json();
        if (!data.length) {
            toast('Adresse introuvable.');
            return;
        }
        const top = data[0];
        addPoint({
            lat: parseFloat(top.lat),
            lng: parseFloat(top.lon),
            address: top.display_name
        }, { zoom: true });
    } catch (err) {
        console.error(err);
        toast('Erreur de géocodage.');
    }
}

$('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('addressInput');
    const q = input.value.trim();
    if (!q) return;
    // If a suggestion is highlighted, the keydown handler picks it.
    geocodeAndAdd(q);
    input.value = '';
    clearSuggestions();
});

// ---------- Address autocomplete (debounced Nominatim) ----------

const sugListEl  = $('suggestions');
const sugInputEl = $('addressInput');
let sugItems  = [];
let sugActive = -1;
let sugAbort  = null;
let sugTimer  = null;

function clearSuggestions() {
    sugListEl.innerHTML = '';
    sugListEl.hidden = true;
    sugItems = [];
    sugActive = -1;
    sugInputEl.setAttribute('aria-expanded', 'false');
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

function highlightMatch(text, q) {
    if (!q) return escapeHtml(text);
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, i))
        + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>'
        + escapeHtml(text.slice(i + q.length));
}

function renderSuggestions(items, q) {
    sugListEl.innerHTML = '';
    sugItems = items;
    sugActive = -1;
    if (!items.length) { sugListEl.hidden = true; sugInputEl.setAttribute('aria-expanded', 'false'); return; }
    items.forEach((it, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.innerHTML = highlightMatch(it.display_name, q);
        // mousedown (not click) so the input doesn't blur first
        li.addEventListener('mousedown', e => {
            e.preventDefault();
            pickSuggestion(i);
        });
        sugListEl.appendChild(li);
    });
    sugListEl.hidden = false;
    sugInputEl.setAttribute('aria-expanded', 'true');
}

function pickSuggestion(i) {
    const it = sugItems[i];
    if (!it) return;
    addPoint({
        lat: parseFloat(it.lat),
        lng: parseFloat(it.lon),
        address: it.display_name
    }, { zoom: true });
    sugInputEl.value = '';
    clearSuggestions();
}

async function fetchSuggestions(q) {
    if (sugAbort) sugAbort.abort();
    sugAbort = new AbortController();
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=fr&limit=5&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'fr' }, signal: sugAbort.signal });
        const data = await res.json();
        renderSuggestions(data, q);
    } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
    }
}

sugInputEl.addEventListener('input', e => {
    const q = e.target.value.trim();
    clearTimeout(sugTimer);
    if (q.length < 3) { clearSuggestions(); return; }
    sugTimer = setTimeout(() => fetchSuggestions(q), 300);
});

sugInputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { clearSuggestions(); return; }
    if (sugListEl.hidden || sugItems.length === 0) return;
    const els = sugListEl.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        sugActive = Math.min(sugItems.length - 1, sugActive + 1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        sugActive = Math.max(-1, sugActive - 1);
    } else if (e.key === 'Enter' && sugActive >= 0) {
        e.preventDefault();
        pickSuggestion(sugActive);
        return;
    } else {
        return;
    }
    els.forEach((el, i) => el.classList.toggle('active', i === sugActive));
    if (sugActive >= 0) els[sugActive].scrollIntoView({ block: 'nearest' });
});

document.addEventListener('click', e => {
    if (!e.target.closest('.search')) clearSuggestions();
});

// ---------- Points model + UI ----------

function shortLabel(p) {
    if (p.address) {
        // Nominatim returns "Number, Street, City, ..." — keep first 2 segments
        const parts = p.address.split(',').map(s => s.trim());
        return parts.slice(0, 2).join(', ');
    }
    return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}

function renderPoints() {
    const list = $('pointsList');
    $('pointsCount').textContent = points.length;
    list.innerHTML = '';
    if (points.length === 0) {
        const li = document.createElement('li');
        li.className = 'points__empty';
        li.textContent = 'Aucun point pour le moment.';
        list.appendChild(li);
        return;
    }
    points.forEach((p, idx) => {
        const li = document.createElement('li');

        const label = document.createElement('span');
        label.className = 'point__label';
        label.title = p.address || `${p.lat}, ${p.lng}`;
        label.textContent = shortLabel(p);

        const btn = document.createElement('button');
        btn.className = 'point__remove';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Supprimer');
        btn.textContent = '×';
        btn.addEventListener('click', () => removePoint(idx));

        li.appendChild(label);
        li.appendChild(btn);
        list.appendChild(li);
    });
}

function addPoint(p, opts = {}) {
    const marker = L.marker([p.lat, p.lng]).addTo(map);
    if (p.address) marker.bindTooltip(shortLabel(p), { direction: 'top', offset: [0, -10] });
    markers.push(marker);
    points.push(p);
    renderPoints();
    if (opts.zoom) map.setView([p.lat, p.lng], 14);
}

function removePoint(idx) {
    map.removeLayer(markers[idx]);
    markers.splice(idx, 1);
    points.splice(idx, 1);
    renderPoints();
    // any previous MEC/result is now stale
    clearComputed();
}

function clearComputed() {
    if (circleLayer)   { map.removeLayer(circleLayer);   circleLayer = null; }
    if (centerMarker)  { map.removeLayer(centerMarker);  centerMarker = null; }
    if (businessMarker){ map.removeLayer(businessMarker); businessMarker = null; }
    hideResult();
}

// ---------- Map-click add mode ----------

map.on('click', e => {
    if (!addingFromMap) return;
    addPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
    setAddFromMap(false);
});

function setAddFromMap(on) {
    addingFromMap = on;
    const btn = $('addFromMapButton');
    btn.classList.toggle('active', on);
    btn.textContent = on ? 'Cliquez sur la carte…' : 'Sur la carte';
}
$('addFromMapButton').addEventListener('click', () => setAddFromMap(!addingFromMap));

// ---------- Clear all ----------

$('clearButton').addEventListener('click', () => {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    points = [];
    clearComputed();
    renderPoints();
});

// ---------- Convex hull toggle ----------

$('toggleHullButton').addEventListener('click', function () {
    if (points.length < 3) {
        toast('Ajoutez au moins 3 points pour l\'enveloppe.');
        return;
    }
    this.classList.toggle('active');
    this.textContent = this.classList.contains('active') ? 'Masquer enveloppe' : 'Enveloppe';
    toggleConvexHullMarkers(map, points);
});

// ---------- Main: compute MEC + find nearest amenity ----------

let searchInFlight = false;
$('searchBusinessButton').addEventListener('click', findMeetingPoint);

async function findMeetingPoint() {
    if (searchInFlight) return;             // ignore double-clicks
    if (points.length < 2) {
        toast('Ajoutez au moins deux points.');
        return;
    }
    const btn = $('searchBusinessButton');
    const origLabel = btn.textContent;
    searchInFlight = true;
    btn.disabled = true;
    btn.textContent = 'Recherche…';
    try {
        await runMeetingPoint();
    } finally {
        searchInFlight = false;
        btn.disabled = false;
        btn.textContent = origLabel;
    }
}

async function runMeetingPoint() {

    const result = computeMinimumEnclosingCircle3D(points);
    if (!result) {
        toast('Impossible de calculer le cercle.');
        return;
    }

    if (circleLayer)  map.removeLayer(circleLayer);
    if (centerMarker) map.removeLayer(centerMarker);

    circleLayer = L.circle([result.center.lat, result.center.lng], {
        radius: result.radius,
        color: '#11ABB0',
        weight: 2,
        fillColor: '#11ABB0',
        fillOpacity: 0.12
    }).addTo(map);

    centerMarker = L.circleMarker([result.center.lat, result.center.lng], {
        radius: 7,
        color: '#11ABB0',
        weight: 2,
        fillColor: '#1bc8cd',
        fillOpacity: 0.95
    }).addTo(map).bindTooltip('Centre du cercle', { permanent: false, direction: 'top' });

    map.fitBounds(circleLayer.getBounds(), { padding: [80, 80] });

    const type = $('businessType').value;
    if (!type) {
        showResult({
            kicker: 'Point central',
            title: 'Centre du cercle minimal',
            meta: `${result.center.lat.toFixed(5)}, ${result.center.lng.toFixed(5)} · rayon ≈ ${(result.radius / 1000).toFixed(2)} km`,
            link: `https://www.openstreetmap.org/?mlat=${result.center.lat}&mlon=${result.center.lng}#map=15/${result.center.lat}/${result.center.lng}`,
            linkLabel: 'Voir sur OpenStreetMap'
        });
        return;
    }

    await findNearestAmenity(result.center, type);
}

const TYPE_TO_AMENITY = {
    restaurant: 'restaurant', cafe: 'cafe', bar: 'bar', hotel: 'hotel',
    supermarket: 'supermarket', pharmacy: 'pharmacy', bank: 'bank'
};

// Read coords for either nodes (lat/lon) or ways/relations (center.lat/lon).
function elemLatLon(el) {
    if (typeof el.lat === 'number') return { lat: el.lat, lon: el.lon };
    if (el.center) return { lat: el.center.lat, lon: el.center.lon };
    return null;
}

// Public Overpass mirrors, tried in order. Kumi Systems is the most lenient
// for casual public usage; openstreetmap.fr is a France-hosted fallback;
// overpass-api.de is the canonical (but heavily rate-limited) endpoint.
const OVERPASS_ENDPOINTS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter'
];

async function overpassFetch(query) {
    let lastErr = null;
    const total = OVERPASS_ENDPOINTS.length;
    for (let i = 0; i < total; i++) {
        const url = OVERPASS_ENDPOINTS[i];
        console.log(`[Overpass] → trying mirror ${i + 1}/${total}: ${url}`);
        toast(`Recherche… (mirror ${i + 1}/${total})`, 12000);

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);   // 10s per mirror
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (res.status === 429 || res.status === 503 || res.status === 504) {
                console.warn(`[Overpass] ${url} → HTTP ${res.status}`);
                lastErr = new Error(`HTTP ${res.status}`);
                continue;
            }
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            console.log(`[Overpass] ${url} → ok`);
            return await res.json();
        } catch (err) {
            clearTimeout(timer);
            const msg = err.name === 'AbortError' ? 'timeout (10s)' : err.message;
            console.warn(`[Overpass] ${url} → ${msg}`);
            lastErr = err;
        }
    }
    throw lastErr || new Error('All Overpass mirrors failed');
}

async function findNearestAmenity(center, type) {
    const amenity = TYPE_TO_AMENITY[type];
    if (!amenity) { toast('Type non supporté.'); return; }

    const radius = 5000;
    const query = `[out:json][timeout:25];
(
  node(around:${radius},${center.lat},${center.lng})[amenity=${amenity}];
  way(around:${radius},${center.lat},${center.lng})[amenity=${amenity}];
  relation(around:${radius},${center.lat},${center.lng})[amenity=${amenity}];
);
out center;`;

    toast(`Recherche du ${type} le plus proche…`, 20000);
    console.log('[Overpass] query:', query);

    try {
        const data = await overpassFetch(query);
        console.log('[Overpass] elements:', data.elements?.length, data);
        const elements = (data.elements || []).filter(elemLatLon);
        if (elements.length === 0) {
            toast('Aucun commerce trouvé dans les environs.');
            return;
        }
        let nearest = elements[0];
        let nearestLL = elemLatLon(nearest);
        let minDist = haversine(center.lat, center.lng, nearestLL.lat, nearestLL.lon);
        for (const place of elements) {
            const ll = elemLatLon(place);
            const d = haversine(center.lat, center.lng, ll.lat, ll.lon);
            if (d < minDist) { nearest = place; nearestLL = ll; minDist = d; }
        }

        if (businessMarker) map.removeLayer(businessMarker);
        // Bright contrasting marker so it's visible on the light basemap.
        businessMarker = L.circleMarker([nearestLL.lat, nearestLL.lon], {
            radius: 9,
            color: '#f4a02a',
            weight: 3,
            fillColor: '#ffd683',
            fillOpacity: 1
        }).addTo(map)
          .bindTooltip(nearest.tags?.name || `(${type})`, { direction: 'top', permanent: true, offset: [0, -10] })
          .openTooltip();

        // Pan/zoom to include the centre AND the amenity, so the result is never offscreen.
        const bounds = L.latLngBounds([
            [center.lat, center.lng],
            [nearestLL.lat, nearestLL.lon]
        ]);
        map.fitBounds(bounds, { padding: [120, 120], maxZoom: 16 });

        const name = nearest.tags?.name || `(${type} sans nom)`;
        const distLabel = minDist >= 1000
            ? `${(minDist / 1000).toFixed(2)} km`
            : `${Math.round(minDist)} m`;
        const gmaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}%20${nearestLL.lat},${nearestLL.lon}`;

        showResult({
            kicker: type,
            title: name,
            meta: `${distLabel} du centre`,
            link: gmaps,
            linkLabel: 'Ouvrir dans Google Maps'
        });
        // dismiss the "recherche en cours" toast
        $('toast').hidden = true;
    } catch (err) {
        console.error('[Overpass] error', err);
        toast('Erreur Overpass / OSM (voir console).');
    }
}

// ---------- Result card ----------

function showResult({ kicker, title, meta, link, linkLabel }) {
    $('resultKicker').textContent = kicker;
    $('resultTitle').textContent = title;
    $('resultMeta').textContent = meta;
    const a = $('resultLink');
    a.href = link;
    a.textContent = linkLabel;
    $('businessInfo').hidden = false;
}
function hideResult() { $('businessInfo').hidden = true; }
$('resultClose').addEventListener('click', hideResult);

// ---------- Haversine (km → m) ----------

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = a => a * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a)) * 1000; // metres
}

// initial render
renderPoints();
