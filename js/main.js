// === main.js — WhereDoWeGo, dark-glass redesign ===
console.log('%c[WhereDoWeGo] main.js build v7 (burger + responsive)', 'color:#11ABB0');

// ============================================================
// CONFIG — Google Places API (New) key is injected at deploy time.
//
// The placeholder below is substituted by the GitHub Actions workflow
// (.github/workflows/pages.yml) using the GOOGLE_PLACES_API_KEY repo
// secret. The plain repo never contains the key.
//
// Locally (file://) the placeholder stays intact and the app shows a
// "key missing" toast — that's expected. Test on the deployed site.
//
// Setup checklist (one-time, see README/notes):
//   1. Enable "Places API (New)" in Google Cloud.
//   2. Create a key, restrict it to:
//        - HTTP referrers: https://dorianjoubaud.com/* and https://dorianjoubaud.github.io/*
//        - API: Places API (New) only
//        - Daily quota cap (recommended: 1000/day).
//   3. GitHub repo → Settings → Secrets → Actions → new secret
//      named GOOGLE_PLACES_API_KEY.
//   4. GitHub repo → Settings → Pages → Source: GitHub Actions.
// ============================================================
const GOOGLE_PLACES_API_KEY = '@@PLACEHOLDER@@';
const HAS_API_KEY = !GOOGLE_PLACES_API_KEY.startsWith('@@');

// Dropdown type -> Google Place types (https://developers.google.com/maps/documentation/places/web-service/place-types).
const TYPE_TO_GOOGLE = {
    restaurant:  ['restaurant'],
    cafe:        ['cafe'],
    bar:         ['bar'],
    hotel:       ['lodging'],
    supermarket: ['supermarket', 'grocery_store'],
    pharmacy:    ['pharmacy'],
    bank:        ['bank']
};

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
        const colour = colorForIndex(idx);

        const swatch = document.createElement('span');
        swatch.className = 'point__swatch';
        swatch.style.background = colour;

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

        li.appendChild(swatch);
        li.appendChild(label);
        li.appendChild(btn);
        list.appendChild(li);
    });
}

function addPoint(p, opts = {}) {
    const idx = points.length;
    const colour = colorForIndex(idx);
    const marker = L.circleMarker([p.lat, p.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: colour,
        fillOpacity: 1
    }).addTo(map);
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
    // Recolour remaining markers so they stay in lockstep with the list swatches.
    markers.forEach((m, i) => m.setStyle({ fillColor: colorForIndex(i) }));
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

// Cycle palette for point markers + sidebar swatches.
const POINT_COLORS = [
    '#ef476f', '#06d6a0', '#ffd166', '#7c5cff',
    '#118ab2', '#f78c6b', '#9b5de5', '#06b6d4'
];
const colorForIndex = i => POINT_COLORS[i % POINT_COLORS.length];

async function findNearestAmenity(center, type) {
    const includedTypes = TYPE_TO_GOOGLE[type];
    if (!includedTypes) { toast('Type non supporté.'); return; }
    if (!HAS_API_KEY) {
        toast('Clé Google Places non injectée (déployez via GitHub Actions).', 6000);
        return;
    }

    const radius = parseInt($('radiusSlider').value, 10) || 5000;
    const minStars = parseInt($('starsSlider').value, 10) || 0;

    const body = {
        includedTypes,
        maxResultCount: 20,
        locationRestriction: {
            circle: {
                center: { latitude: center.lat, longitude: center.lng },
                radius: radius
            }
        }
    };

    toast(`Recherche du ${type} le plus proche…`, 15000);
    console.log('[GooglePlaces] body:', body);

    const fields = [
        'places.displayName',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.formattedAddress',
        'places.googleMapsUri',
        'places.priceLevel'
    ].join(',');

    try {
        const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
                'X-Goog-FieldMask': fields
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errText = await res.text();
            console.error('[GooglePlaces] HTTP', res.status, errText);
            toast(`Google Places: HTTP ${res.status} (voir console).`);
            return;
        }
        const data = await res.json();
        console.log('[GooglePlaces] results:', data.places?.length, data);

        let places = data.places || [];
        if (places.length === 0) {
            toast('Aucun commerce trouvé dans les environs.');
            return;
        }
        if (minStars > 0) {
            const before = places.length;
            places = places.filter(p => typeof p.rating === 'number' && p.rating >= minStars);
            console.log(`[stars] ${before} → ${places.length} after >=${minStars}*`);
            if (places.length === 0) {
                toast(`Aucun commerce avec ${minStars}+ étoiles dans les environs.`);
                return;
            }
        }

        let nearest = null;
        let nearestLL = null;
        let minDist = Infinity;
        for (const p of places) {
            const ll = { lat: p.location.latitude, lon: p.location.longitude };
            const d = haversine(center.lat, center.lng, ll.lat, ll.lon);
            if (d < minDist) { nearest = p; nearestLL = ll; minDist = d; }
        }

        if (businessMarker) map.removeLayer(businessMarker);
        businessMarker = L.circleMarker([nearestLL.lat, nearestLL.lon], {
            radius: 9,
            color: '#f4a02a',
            weight: 3,
            fillColor: '#ffd683',
            fillOpacity: 1
        }).addTo(map)
          .bindTooltip(nearest.displayName?.text || `(${type})`, { direction: 'top', permanent: true, offset: [0, -10] })
          .openTooltip();

        const bounds = L.latLngBounds([
            [center.lat, center.lng],
            [nearestLL.lat, nearestLL.lon]
        ]);
        map.fitBounds(bounds, { padding: [120, 120], maxZoom: 16 });

        const name = nearest.displayName?.text || `(${type} sans nom)`;
        const distLabel = minDist >= 1000
            ? `${(minDist / 1000).toFixed(2)} km`
            : `${Math.round(minDist)} m`;
        const metaBits = [];
        if (typeof nearest.rating === 'number') {
            metaBits.push(`★ ${nearest.rating.toFixed(1)} (${nearest.userRatingCount ?? 0})`);
        }
        metaBits.push(`${distLabel} du centre`);

        showResult({
            kicker: type,
            title: name,
            meta: metaBits.join(' · '),
            link: nearest.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}%20${nearestLL.lat},${nearestLL.lon}`,
            linkLabel: 'Ouvrir dans Google Maps'
        });
        $('toast').hidden = true;
    } catch (err) {
        console.error('[GooglePlaces] error', err);
        toast('Erreur Google Places (voir console).');
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

// ---------- Panel toggle ----------

const controlsPanel = $('controls');
const panelToggleBtn = $('panelToggle');

function setPanelOpen(open) {
    controlsPanel.classList.toggle('panel--hidden', !open);
    panelToggleBtn.setAttribute('aria-expanded', String(open));
}
panelToggleBtn.addEventListener('click', () => {
    const willOpen = controlsPanel.classList.contains('panel--hidden');
    setPanelOpen(willOpen);
});
// On phones, default the panel to closed so the user sees the map first.
if (window.matchMedia('(max-width: 600px)').matches) {
    setPanelOpen(false);
}

// ---------- Filter slider labels ----------

function formatRadius(m) {
    return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${m} m`;
}
const radiusSlider = $('radiusSlider');
const radiusLabel  = $('radiusLabel');
radiusSlider.addEventListener('input', () => {
    radiusLabel.textContent = formatRadius(parseInt(radiusSlider.value, 10));
});
radiusLabel.textContent = formatRadius(parseInt(radiusSlider.value, 10));

const starsSlider = $('starsSlider');
const starsLabel  = $('starsLabel');
function updateStarsLabel() {
    const n = parseInt(starsSlider.value, 10);
    starsLabel.textContent = n === 0 ? 'aucune' : '★'.repeat(n) + ` (${n}+)`;
}
starsSlider.addEventListener('input', updateStarsLabel);
updateStarsLabel();

// initial render
renderPoints();
