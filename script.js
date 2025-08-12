let map, userMarker, destMarker, routeControl;
let destLat = null, destLng = null;
let notified = {};

document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("destinationInput");
    const button = document.getElementById("startBtn");

    // Handle destination input on home page with search history saving
    if (input && button) {
        button.addEventListener("click", () => {
            const value = input.value.trim();
            if (value) {
                // Save to searchHistory in localStorage (avoid duplicates)
                let history = JSON.parse(localStorage.getItem("searchHistory")) || [];
                if (!history.includes(value)) {
                    history.push(value);
                    localStorage.setItem("searchHistory", JSON.stringify(history));
                }

                sessionStorage.setItem("destination", value);
                window.location.href = "track.html";
            } else {
                alert("Please enter a destination.");
            }
        });
    }

    // Show map on home page if #home-map exists
    if (document.getElementById("home-map")) {
        showUserLocation();
    }

    // If on tracking page, start tracking destination
    if (window.location.pathname.includes("track.html")) {
        trackDestination();
    }

    // Load trip history if on history page
    if (document.getElementById("history-list")) {
        loadTripHistory();
    }
});

// ----------- TRACKING LOGIC -----------

function trackDestination() {
    const destination = sessionStorage.getItem("destination");
    if (!destination) return;

    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}`;
    fetch(geocodeUrl)
        .then(res => res.json())
        .then(data => {
            if (data && data[0]) {
                destLat = parseFloat(data[0].lat);
                destLng = parseFloat(data[0].lon);
                initMapWithTracking();
                const statusEl = document.getElementById("status");
                if (statusEl) statusEl.innerText = `Destination: ${destination}`;
            } else {
                const statusEl = document.getElementById("status");
                if (statusEl) statusEl.innerText = "Destination not found.";
            }
        })
        .catch(err => {
            console.error("Geocoding error:", err);
            const statusEl = document.getElementById("status");
            if (statusEl) statusEl.innerText = "Error fetching destination.";
        });
}

function initMapWithTracking() {
    map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Map © OpenStreetMap contributors'
    }).addTo(map);

    const bounds = L.latLngBounds([L.latLng(destLat, destLng)]);
    destMarker = L.marker([destLat, destLng]).addTo(map).bindPopup("Destination").openPopup();

    // Update position every 5 seconds
    setInterval(() => {
        navigator.geolocation.getCurrentPosition((pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            if (!userMarker) {
                userMarker = L.marker([lat, lng]).addTo(map).bindPopup("You are here").openPopup();
            } else {
                userMarker.setLatLng([lat, lng]);
            }

            const distance = haversine(lat, lng, destLat, destLng);
            const statusEl = document.getElementById("status");
            if (statusEl) statusEl.innerText = `Distance: ${distance.toFixed(2)} km`;

            checkNotifications(distance);

            if (!routeControl) {
                routeControl = L.Routing.control({
                    waypoints: [
                        L.latLng(lat, lng),
                        L.latLng(destLat, destLng)
                    ],
                    routeWhileDragging: false,
                    addWaypoints: false,
                    draggableWaypoints: false,
                    createMarker: () => null,
                    show: false
                }).addTo(map);
            } else {
                routeControl.setWaypoints([
                    L.latLng(lat, lng),
                    L.latLng(destLat, destLng)
                ]);
            }

            // Fit map bounds only once
            if (!map._fitted) {
                bounds.extend([lat, lng]);
                map.fitBounds(bounds, { padding: [50, 50] });
                map._fitted = true;
            }
        }, (err) => {
            console.error("Geolocation error:", err);
        });
    }, 5000);
}

// ----------- NOTIFICATIONS -----------

function checkNotifications(distance) {
    if (distance < 0.3 && !notified["arrived"]) {
        notify("📍 You've arrived!");
        saveTripHistory(sessionStorage.getItem("destination"), distance);
        notified["arrived"] = true;
    } else if (distance < 0.75 && !notified["500m"]) {
        notify("500m remaining");
        notified["500m"] = true;
    } else if (distance < 1 && !notified["1km"]) {
        notify("1km remaining");
        notified["1km"] = true;
    } else if (distance < 2 && !notified["2km"]) {
        notify("2km remaining");
        notified["2km"] = true;
    }
}

function notify(msg) {
    alert(msg);
    const alarm = document.getElementById("alarmSound");
    if (alarm && msg.includes("arrived")) {
        alarm.play().catch(err => console.warn("Audio play blocked:", err));
    }
}

// ----------- HELPER FUNCTIONS -----------

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// ----------- HOME PAGE MAP -----------

function showUserLocation() {
    map = L.map('home-map').setView([7.8731, 80.7718], 7); // Center Sri Lanka
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Map © OpenStreetMap contributors'
    }).addTo(map);

    navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        map.setView([lat, lng], 14);
        L.marker([lat, lng]).addTo(map).bindPopup("You are here").openPopup();
    }, (err) => {
        console.warn("Geolocation failed:", err);
        alert("Unable to access your location.");
    });
}

// ----------- HISTORY PAGE -----------

function saveTripHistory(destination, distance) {
    const trips = JSON.parse(localStorage.getItem("tripHistory")) || [];
    trips.push({
        destination,
        distance: distance.toFixed(2),
        time: new Date().toLocaleString()
    });
    localStorage.setItem("tripHistory", JSON.stringify(trips));
}

function loadTripHistory() {
    const trips = JSON.parse(localStorage.getItem("tripHistory")) || [];
    const list = document.getElementById("history-list");

    if (!list) return;

    if (trips.length === 0) {
        list.innerHTML = "<p>No trips recorded yet.</p>";
        return;
    }

    list.innerHTML = "";
    trips.forEach(trip => {
        const item = document.createElement("li");
        item.textContent = `${trip.time} - ${trip.destination} (${trip.distance} km)`;
        list.appendChild(item);
    });
}
