// === main.js ===

let map = L.map('map').setView([48.8566, 2.3522], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let points = [];
let markers = [];
let circleLayer = null;
let centerMarker = null;
let businessMarker = null;
let addingFromMap = false;

L.Control.geocoder({
  collapsed: false,            // champ toujours visible
  placeholder: 'Entrez une adresse…',
  defaultMarkGeocode: false,   // on gère nous-même le marqueur
  geocoder: L.Control.Geocoder.nominatim({
    countrycodes: 'fr'         // limite à la France
  })
})
  .on('markgeocode', function(e) {
    const center = e.geocode.center;

    // a) ajoute le marqueur sur la carte
    const marker = L.marker(center).addTo(map);
    markers.push(marker);

    // b) mémorise le point (lat, lng, adresse)
    points.push({
      lat: center.lat,
      lng: center.lng,
      address: e.geocode.name
    });

    // c) met à jour la liste et recentre la carte
    updatePointsList();
    map.setView(center, 15);
  })
  .addTo(map);


function updatePointsList() {
  const list = document.getElementById('pointsList');
  list.innerHTML = '';
  points.forEach((p, idx) => {
    const div = document.createElement('div');
    div.textContent = p.address || `Lat: ${p.lat.toFixed(5)}, Lng: ${p.lng.toFixed(5)}`;
    list.appendChild(div);
  });
}

// Ajouter un point en cliquant sur la carte
map.on('click', function (e) {
  if (!addingFromMap) return;
  const latlng = e.latlng;
  const marker = L.marker([latlng.lat, latlng.lng]).addTo(map);
  markers.push(marker);
  points.push({ lat: latlng.lat, lng: latlng.lng });
  updatePointsList();
  addingFromMap = false;
  document.getElementById('addFromMapButton').textContent = "Ajouter sur la carte";
});

document.getElementById('addFromMapButton').addEventListener('click', () => {
  addingFromMap = !addingFromMap;
  const btn = document.getElementById('addFromMapButton');
  btn.classList.toggle('active', addingFromMap);
  btn.textContent = addingFromMap ? "Cliquez sur la carte…" : "Ajouter sur la carte";
});

document.getElementById('clearButton').addEventListener('click', () => {
  points = [];
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  if (circleLayer) map.removeLayer(circleLayer);
  if (centerMarker) map.removeLayer(centerMarker);
  if (businessMarker) map.removeLayer(businessMarker);
  document.getElementById('businessInfo').style.display = 'none';
  updatePointsList();
});

document.getElementById('searchBusinessButton').addEventListener('click', findNearestBusiness);

function findNearestBusiness() {
    if (!points || points.length < 2) {
      alert("Ajoutez au moins deux points.");
      return;
    }
  
    // Calcul du cercle englobant
    const result = computeMinimumEnclosingCircle3D(points);
    if (result) {
      if (circleLayer) map.removeLayer(circleLayer);
      if (centerMarker) map.removeLayer(centerMarker);
  
      circleLayer = L.circle([result.center.lat, result.center.lng], {
        radius: result.radius,
        color: 'red',
        fillOpacity: 0.2
      }).addTo(map);
  
      centerMarker = L.marker([result.center.lat, result.center.lng])
        .addTo(map)
        .bindPopup(`Centre du cercle<br>Lat: ${result.center.lat.toFixed(5)}<br>Lng: ${result.center.lng.toFixed(5)}`)
        .openPopup();
    }
  
    // Si aucun type de commerce n'est sélectionné, on arrête ici.
    const type = document.getElementById('businessType').value;
    if (!type) {
      return;
    }
  
    // Poursuite de la recherche du commerce le plus proche
    const center = result.center;
    const searchRadius = 5000; // rayon de recherche en mètres
  
    const amenityType = mapTypeToAmenity(type);
    if (!amenityType) {
      alert("Ce type n'est pas supporté par OpenStreetMap.");
      return;
    }
  
    const overpassQuery = `
      [out:json];
      node(around:${searchRadius},${center.lat},${center.lng})[amenity=${amenityType}];
      out body;
    `;
  
    fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: overpassQuery
    })
      .then(res => res.json())
      .then(data => {
        if (!data.elements || data.elements.length === 0) {
          alert("Aucun commerce trouvé dans les environs.");
          return;
        }
  
        let nearest = data.elements[0];
        let minDist = haversine(center.lat, center.lng, nearest.lat, nearest.lon);
  
        for (let place of data.elements) {
          const d = haversine(center.lat, center.lng, place.lat, place.lon);
          if (d < minDist) {
            nearest = place;
            minDist = d;
          }
        }
  
        if (businessMarker) map.removeLayer(businessMarker);
        businessMarker = L.marker([nearest.lat, nearest.lon], {
          icon: L.icon({
            iconUrl: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
            iconSize: [32, 32]
          })
        }).addTo(map)
          .bindPopup(`<b>${nearest.tags.name || "(nom inconnu)"}</b><br>Type: ${type}`)
          .openPopup();
  
        const nameEncoded = encodeURIComponent(nearest.tags.name || '');
        const gmapsLink = `https://www.google.com/maps/search/?api=1&query=${nameEncoded}%20près%20de%20${nearest.lat},${nearest.lon}`;
  
        const infoDiv = document.getElementById("businessInfo");
        infoDiv.style.display = "block";
        infoDiv.innerHTML = `
          <strong>${type.charAt(0).toUpperCase() + type.slice(1)} le plus proche</strong><br>
          <b>Nom :</b> ${nearest.tags.name || "(nom inconnu)"}<br>
          <b>Type :</b> ${type}<br>
          <a href="${gmapsLink}" target="_blank">📍 Voir sur Google Maps</a>
        `;
      })
      .catch(err => {
        console.error(err);
        alert("Erreur lors de la recherche sur OpenStreetMap.");
      });
  }
document.getElementById('toggleHullButton').addEventListener('click', function () {
    this.classList.toggle('active');
    this.textContent = this.classList.contains('active')
      ? "Masquer enveloppe convexe"
      : "Afficher enveloppe convexe";
  
    toggleConvexHullMarkers(map, points);
  });
  
function mapTypeToAmenity(type) {
  const mapping = {
    restaurant: 'restaurant',
    cafe: 'cafe',
    bar: 'bar',
    hotel: 'hotel',
    supermarket: 'supermarket',
    pharmacy: 'pharmacy',
    bank: 'bank'
  };
  return mapping[type] || null;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = angle => angle * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) * 1000; // return in meters
}

