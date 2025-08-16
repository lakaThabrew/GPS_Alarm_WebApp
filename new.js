/**
 * Enhanced GPS Tracker with Modern Notification System
 * Well-organized modular architecture
 */

// =============================================================================
// CONFIGURATION & CONSTANTS
// =============================================================================

const CONFIG = {
    geolocation: {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000
    },
    notifications: {
        durations: {
            short: 2000,
            medium: 4000,
            long: 8000,
            persistent: 10000
        }
    },
    distances: {
        arrived: 0.3,      // 300m
        close: 0.75,       // 750m
        near: 1,           // 1km
        approaching: 2     // 2km
    },
    storage: {
        maxHistory: 50,
        maxTrips: 100
    },
    api: {
        nominatim: 'https://nominatim.openstreetmap.org',
        tileLayers: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    }
};

// =============================================================================
// GLOBAL STATE MANAGEMENT
// =============================================================================

class AppState {
    constructor() {
        this.map = null;
        this.userMarker = null;
        this.destMarker = null;
        this.routeControl = null;
        this.destLat = null;
        this.destLng = null;
        this.notified = {};
        this.watchId = null;
        this.isTracking = false;
        this.trackingStartTime = null;
    }

    reset() {
        this.notified = {};
        this.isTracking = false;
        this.trackingStartTime = null;
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }
}

const appState = new AppState();

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

class Utils {
    static haversine(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth radius in km
        const dLat = this.deg2rad(lat2 - lat1);
        const dLon = this.deg2rad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
            Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    static deg2rad(deg) {
        return deg * (Math.PI / 180);
    }

    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    static formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    }

    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    static async retryOperation(operation, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
    }
}

// =============================================================================
// NOTIFICATION SYSTEM
// =============================================================================

class NotificationSystem {
    constructor() {
        this.container = null;
        this.wakeLock = null;
        this.init();
    }

    async init() {
        this.createContainer();
        await this.requestPermissions();
    }

    createContainer() {
        // Remove existing container
        const existing = document.getElementById('mobile-notifications');
        if (existing) existing.remove();

        this.container = document.createElement('div');
        this.container.id = 'mobile-notifications';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            max-width: 90vw;
            width: 350px;
            pointer-events: none;
        `;
        document.body.appendChild(this.container);
    }

    async requestPermissions() {
        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            try {
                await Notification.requestPermission();
            } catch (error) {
                console.log('Notification permission request failed:', error);
            }
        }

        // Request wake lock for tracking
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
            } catch (error) {
                console.log('Wake lock request failed:', error);
            }
        }
    }

    show(message, type = 'info', duration = CONFIG.notifications.durations.medium, isImportant = false) {
        this.showInAppNotification(message, type, duration);

        if (isImportant) {
            this.showNativeNotification(message, type);
            this.vibrate(type);
            
            if (message.includes('arrived')) {
                this.playNotificationSound();
            }
        }
    }

    showInAppNotification(message, type, duration) {
        const notification = document.createElement('div');
        const id = 'notif-' + Date.now();
        notification.id = id;
        
        const colors = {
            success: { bg: '#d4edda', border: '#c3e6cb', text: '#155724', icon: '✓' },
            error: { bg: '#f8d7da', border: '#f5c6cb', text: '#721c24', icon: '✗' },
            warning: { bg: '#fff3cd', border: '#ffeaa7', text: '#856404', icon: '⚠' },
            info: { bg: '#d1ecf1', border: '#bee5eb', text: '#0c5460', icon: 'ℹ' }
        };

        const color = colors[type] || colors.info;

        notification.style.cssText = `
            background: ${color.bg};
            border: 2px solid ${color.border};
            color: ${color.text};
            padding: 15px 20px;
            margin-bottom: 10px;
            border-radius: 12px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
            font-size: 14px;
            font-weight: 500;
            transform: translateY(-100px) scale(0.8);
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            pointer-events: all;
            cursor: pointer;
            backdrop-filter: blur(10px);
            position: relative;
            overflow: hidden;
        `;

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px; flex-shrink: 0;">${color.icon}</span>
                <span style="flex: 1; line-height: 1.4;">${message}</span>
                <button style="
                    background: none; 
                    border: none; 
                    color: ${color.text}; 
                    font-size: 18px; 
                    cursor: pointer;
                    opacity: 0.7;
                    padding: 0;
                    margin-left: 10px;
                " onclick="notificationSystem.remove('${id}')">×</button>
            </div>
            <div style="
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                background: ${color.border};
                width: 100%;
                transform-origin: left;
                animation: progress ${duration}ms linear forwards;
            "></div>
        `;

        this.addProgressAnimation();
        this.container.appendChild(notification);

        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateY(0) scale(1)';
            notification.style.opacity = '1';
        }, 100);

        // Auto remove
        setTimeout(() => this.remove(id), duration);

        // Click to remove
        notification.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                this.remove(id);
            }
        });
    }

    addProgressAnimation() {
        if (!document.getElementById('progress-animation')) {
            const style = document.createElement('style');
            style.id = 'progress-animation';
            style.textContent = `
                @keyframes progress {
                    from { transform: scaleX(1); }
                    to { transform: scaleX(0); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    showNativeNotification(message, type) {
        if ('Notification' in window && Notification.permission === 'granted') {
            const icons = {
                success: '✅',
                error: '⌫',
                warning: '⚠️',
                info: 'ℹ️'
            };

            new Notification(`GPS Alarm ${icons[type] || icons.info}`, {
                body: message,
                icon: '/favicon.ico',
                badge: '/favicon.ico',
                tag: 'gps-alarm',
                requireInteraction: type === 'success',
                silent: false
            });
        }
    }

    vibrate(type) {
        if ('navigator' in window && 'vibrate' in navigator) {
            const patterns = {
                success: [100, 50, 100],
                warning: [200, 100, 200, 100, 200],
                error: [300, 100, 300],
                info: [100]
            };
            navigator.vibrate(patterns[type] || patterns.info);
        }
    }

    playNotificationSound() {
        try {
            const alarm = document.getElementById("alarmSound");
            if (alarm) {
                alarm.volume = 0.7;
                alarm.play().catch(err => console.log("Audio play failed:", err));
            } else {
                this.playBeepSound();
            }
        } catch (error) {
            console.log('Sound notification failed:', error);
        }
    }

    playBeepSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 1);
        } catch (error) {
            console.log('Beep sound failed:', error);
        }
    }

    remove(id) {
        const notification = document.getElementById(id);
        if (notification) {
            notification.style.transform = 'translateY(-100px) scale(0.8)';
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 400);
        }
    }

    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    showLoading(message = 'Loading...') {
        const notification = document.createElement('div');
        notification.id = 'loading-notification';
        
        notification.style.cssText = `
            background: #f8f9fa;
            border: 2px solid #dee2e6;
            color: #495057;
            padding: 15px 20px;
            margin-bottom: 10px;
            border-radius: 12px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
            font-size: 14px;
            font-weight: 500;
            transform: translateY(-100px) scale(0.8);
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            pointer-events: all;
        `;

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px;">
                <div style="
                    width: 20px;
                    height: 20px;
                    border: 2px solid #dee2e6;
                    border-top: 2px solid #007bff;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                "></div>
                <span>${message}</span>
            </div>
        `;

        this.addSpinAnimation();
        this.container.appendChild(notification);

        setTimeout(() => {
            notification.style.transform = 'translateY(0) scale(1)';
            notification.style.opacity = '1';
        }, 100);

        return notification.id;
    }

    addSpinAnimation() {
        if (!document.getElementById('spin-animation')) {
            const style = document.createElement('style');
            style.id = 'spin-animation';
            style.textContent = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    hideLoading() {
        this.remove('loading-notification');
    }

    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
        }
    }
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

class ErrorHandler {
    static handleGeolocationError(error) {
        let message = '';
        let suggestions = '';
        
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = 'Location access denied';
                suggestions = 'Please enable location permissions in your browser settings';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'Location unavailable';
                suggestions = 'Please check your GPS or try moving to an open area';
                break;
            case error.TIMEOUT:
                message = 'Location request timed out';
                suggestions = 'Please try again';
                break;
            default:
                message = 'Unknown location error';
                suggestions = 'Please try refreshing the page';
                break;
        }
        
        notificationSystem.show(
            `${message}. ${suggestions}`, 
            'error', 
            CONFIG.notifications.durations.long
        );
    }

    static handleNetworkError(error, context = '') {
        console.error(`Network error in ${context}:`, error);
        notificationSystem.show(
            `Network error ${context}. Please check your internet connection and try again.`,
            'error',
            CONFIG.notifications.durations.medium
        );
    }
}

// =============================================================================
// API SERVICES
// =============================================================================

class LocationService {
    static async searchDestinations(query) {
        const response = await Utils.retryOperation(async () => {
            const res = await fetch(
                `${CONFIG.api.nominatim}/search?format=json&limit=8&countrycodes=lk&q=${encodeURIComponent(query + ' Sri Lanka')}`,
                { timeout: 10000 }
            );
            if (!res.ok) throw new Error('Search failed');
            return res;
        });

        return await response.json();
    }

    static async validateDestination(destination) {
        try {
            const response = await fetch(
                `${CONFIG.api.nominatim}/search?format=json&limit=1&q=${encodeURIComponent(destination)}`
            );
            const data = await response.json();
            return data && data.length > 0;
        } catch (error) {
            console.error('Destination validation error:', error);
            return false;
        }
    }

    static async geocodeDestination(destination) {
        const response = await Utils.retryOperation(async () => {
            const res = await fetch(
                `${CONFIG.api.nominatim}/search?format=json&q=${encodeURIComponent(destination)}`
            );
            if (!res.ok) throw new Error('Geocoding failed');
            return res;
        });

        return await response.json();
    }
}

// =============================================================================
// STORAGE SERVICES
// =============================================================================

class StorageService {
    static saveSearchHistory(destination) {
        try {
            let history = JSON.parse(localStorage.getItem("searchHistory")) || [];
            
            // Remove existing entry to avoid duplicates
            history = history.filter(item => {
                const query = typeof item === 'string' ? item : item.query;
                return query !== destination;
            });
            
            const newEntry = {
                query: destination,
                timestamp: new Date().toISOString(),
                id: Utils.generateId()
            };
            
            history.unshift(newEntry);
            
            if (history.length > CONFIG.storage.maxHistory) {
                history = history.slice(0, CONFIG.storage.maxHistory);
            }
            
            localStorage.setItem("searchHistory", JSON.stringify(history));
        } catch (error) {
            console.error('Error saving search history:', error);
        }
    }

    static saveTripHistory(destination, distance, duration = 0) {
        try {
            const trips = JSON.parse(localStorage.getItem("tripHistory")) || [];
            
            const newTrip = {
                id: Utils.generateId(),
                destination: destination,
                distance: parseFloat(distance.toFixed(2)),
                duration: duration,
                timestamp: new Date().toISOString(),
                date: new Date().toLocaleDateString(),
                time: new Date().toLocaleTimeString()
            };
            
            trips.unshift(newTrip);
            
            if (trips.length > CONFIG.storage.maxTrips) {
                trips.splice(CONFIG.storage.maxTrips);
            }
            
            localStorage.setItem("tripHistory", JSON.stringify(trips));
            
            notificationSystem.show(
                `Trip saved: ${destination} (${distance.toFixed(2)} km)`,
                'success',
                CONFIG.notifications.durations.medium
            );
            
        } catch (error) {
            console.error('Error saving trip history:', error);
            notificationSystem.show('Failed to save trip history', 'error');
        }
    }
}

// =============================================================================
// MAP SERVICES
// =============================================================================

class MapService {
    static initializeMap(elementId, center = [7.8731, 80.7718], zoom = 8) {
        const map = L.map(elementId, {
            zoomControl: true,
            attributionControl: false
        });

        L.tileLayer(CONFIG.api.tileLayers, {
            attribution: 'Map © OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(map);

        map.setView(center, zoom);
        return map;
    }

    static createMarker(lat, lng, color = 'blue', popupText = '') {
        const marker = L.marker([lat, lng], {
            icon: L.icon({
                iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            })
        });

        if (popupText) {
            marker.bindPopup(popupText);
        }

        return marker;
    }

    static createRoute(map, startLat, startLng, endLat, endLng) {
        return L.Routing.control({
            waypoints: [
                L.latLng(startLat, startLng),
                L.latLng(endLat, endLng)
            ],
            routeWhileDragging: false,
            addWaypoints: false,
            draggableWaypoints: false,
            createMarker: () => null,
            lineOptions: {
                styles: [
                    { color: '#007bff', weight: 6, opacity: 0.8 }
                ]
            },
            show: false
        }).addTo(map);
    }
}

// =============================================================================
// TRACKING LOGIC
// =============================================================================

class TrackingService {
    static startPositionTracking() {
        appState.isTracking = true;
        
        if (appState.watchId) {
            navigator.geolocation.clearWatch(appState.watchId);
        }

        appState.watchId = navigator.geolocation.watchPosition(
            this.handlePositionUpdate.bind(this),
            ErrorHandler.handleGeolocationError,
            CONFIG.geolocation
        );

        // Backup position requests
        const backupInterval = setInterval(() => {
            if (!appState.isTracking) {
                clearInterval(backupInterval);
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                this.handlePositionUpdate.bind(this),
                (error) => console.log('Backup position request failed:', error),
                CONFIG.geolocation
            );
        }, 10000);
    }

    static handlePositionUpdate(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        this.updateUserMarker(lat, lng);
        this.updateStatus(position);
        this.updateRoute(lat, lng);
        this.checkNotifications(lat, lng);
        this.fitMapBounds(lat, lng);
    }

    static updateUserMarker(lat, lng) {
        if (!appState.userMarker) {
            appState.userMarker = MapService.createMarker(lat, lng, 'blue', '📍 You are here');
            appState.userMarker.addTo(appState.map);
        } else {
            appState.userMarker.setLatLng([lat, lng]);
        }
    }

    static updateStatus(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        
        const distance = Utils.haversine(lat, lng, appState.destLat, appState.destLng);
        
        const statusEl = document.getElementById("status");
        if (statusEl) {
            const speed = position.coords.speed ? `${Math.round(position.coords.speed * 3.6)} km/h` : 'Unknown';
            statusEl.innerHTML = `
                Distance: ${distance.toFixed(2)} km<br>
                Speed: ${speed}<br>
                Accuracy: ±${Math.round(accuracy)}m
            `;
        }
    }

    static updateRoute(lat, lng) {
        if (!appState.routeControl) {
            appState.routeControl = MapService.createRoute(
                appState.map, lat, lng, appState.destLat, appState.destLng
            );
        } else {
            appState.routeControl.setWaypoints([
                L.latLng(lat, lng),
                L.latLng(appState.destLat, appState.destLng)
            ]);
        }
    }

    static checkNotifications(lat, lng) {
        const distance = Utils.haversine(lat, lng, appState.destLat, appState.destLng);
        
        if (distance < CONFIG.distances.arrived && !appState.notified["arrived"]) {
            this.handleArrival(distance);
        } else if (distance < CONFIG.distances.close && !appState.notified["500m"]) {
            notificationSystem.show('📍 500 meters remaining to destination', 'warning', CONFIG.notifications.durations.medium, true);
            appState.notified["500m"] = true;
        } else if (distance < CONFIG.distances.near && !appState.notified["1km"]) {
            notificationSystem.show('📍 1 kilometer remaining to destination', 'info', CONFIG.notifications.durations.medium, true);
            appState.notified["1km"] = true;
        } else if (distance < CONFIG.distances.approaching && !appState.notified["2km"]) {
            notificationSystem.show('📍 2 kilometers remaining to destination', 'info', CONFIG.notifications.durations.short);
            appState.notified["2km"] = true;
        }
    }

    static handleArrival(distance) {
        const tripDuration = appState.trackingStartTime ? 
            Math.round((new Date() - appState.trackingStartTime) / 60000) : 0;
        
        notificationSystem.show(
            `🎉 You've arrived at your destination! Trip took ${tripDuration} minutes.`,
            'success',
            CONFIG.notifications.durations.persistent,
            true
        );
        
        StorageService.saveTripHistory(
            sessionStorage.getItem("destination"), 
            distance, 
            tripDuration
        );
        
        appState.notified["arrived"] = true;
        this.stopTracking();
    }

    static fitMapBounds(lat, lng) {
        if (!appState.map._fitted) {
            const bounds = L.latLngBounds([
                [lat, lng],
                [appState.destLat, appState.destLng]
            ]);
            appState.map.fitBounds(bounds, { padding: [50, 50] });
            appState.map._fitted = true;
        }
    }

    static stopTracking() {
        appState.isTracking = false;
        if (appState.watchId) {
            navigator.geolocation.clearWatch(appState.watchId);
            appState.watchId = null;
        }
        notificationSystem.releaseWakeLock();
    }
}

// =============================================================================
// PAGE CONTROLLERS
// =============================================================================

class HomePageController {
    static async init() {
        this.setupDestinationInput();
        this.setupStartButton();
        await this.showUserLocation();
    }

    static setupDestinationInput() {
        const input = document.getElementById("destinationInput");
        const suggestionsBox = document.getElementById("suggestions");

        if (!input || !suggestionsBox) return;

        const debouncedSearch = Utils.debounce(async (query) => {
            if (query.length < 3) {
                suggestionsBox.style.display = "none";
                return;
            }

            suggestionsBox.innerHTML = '<div style="padding: 10px; text-align: center; color: #666;">Searching...</div>';
            suggestionsBox.style.display = "block";

            try {
                const results = await LocationService.searchDestinations(query);
                this.displaySuggestions(results, suggestionsBox, input);
            } catch (error) {
                console.error("Search error:", error);
                suggestionsBox.innerHTML = '<div style="padding: 10px; text-align: center; color: #dc3545;">Search failed. Please try again.</div>';
            }
        }, 300);

        input.addEventListener("input", (e) => debouncedSearch(e.target.value.trim()));

        document.addEventListener("click", (e) => {
            if (!input.contains(e.target) && !suggestionsBox.contains(e.target)) {
                suggestionsBox.style.display = "none";
            }
        });
    }

    static displaySuggestions(results, suggestionsBox, input) {
        suggestionsBox.innerHTML = "";
        
        if (results.length > 0) {
            results.forEach((place) => {
                const div = document.createElement("div");
                div.style.cssText = `
                    padding: 12px 15px;
                    cursor: pointer;
                    border-bottom: 1px solid #eee;
                    transition: background-color 0.2s ease;
                    font-size: 14px;
                    line-height: 1.4;
                `;
                
                div.innerHTML = place.display_name;
                
                div.addEventListener("mouseenter", () => {
                    div.style.backgroundColor = "#f8f9fa";
                });
                
                div.addEventListener("mouseleave", () => {
                    div.style.backgroundColor = "white";
                });
                
                div.addEventListener("click", () => {
                    input.value = place.display_name;
                    suggestionsBox.style.display = "none";
                    notificationSystem.show('Destination selected', 'info', CONFIG.notifications.durations.short);
                });
                
                suggestionsBox.appendChild(div);
            });
            suggestionsBox.style.display = "block";
        } else {
            suggestionsBox.innerHTML = '<div style="padding: 10px; text-align: center; color: #666;">No locations found</div>';
        }
    }

    static setupStartButton() {
        const input = document.getElementById("destinationInput");
        const button = document.getElementById("startBtn");

        if (!input || !button) return;

        const handleDestination = async () => {
            const value = input.value.trim();
            if (!value) {
                notificationSystem.show('Please enter a destination', 'warning');
                input.focus();
                return;
            }

            button.disabled = true;
            button.textContent = 'Setting Destination...';
            
            try {
                StorageService.saveSearchHistory(value);
                sessionStorage.setItem("destination", value);
                
                const isValid = await LocationService.validateDestination(value);
                if (isValid) {
                    notificationSystem.show('Destination set successfully! Redirecting...', 'success');
                    setTimeout(() => {
                        window.location.href = "track.html";
                    }, 1000);
                } else {
                    notificationSystem.show('Unable to find this destination. Please try a different location.', 'error');
                }
            } catch (error) {
                ErrorHandler.handleNetworkError(error, 'while setting destination');
            } finally {
                button.disabled = false;
                button.textContent = 'Start Tracking';
            }
        };

        button.addEventListener("click", handleDestination);
        input.addEventListener("keypress", (e) => {
            if (e.key === 'Enter') {
                handleDestination();
            }
        });
    }

    static async showUserLocation() {
        const mapElement = document.getElementById("home-map");
        if (!mapElement) return;

        try {
            appState.map = MapService.initializeMap('home-map');
            
            const loadingId = notificationSystem.showLoading('Finding your location...');

            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, CONFIG.geolocation);
            });

            notificationSystem.hideLoading();

            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = position.coords.accuracy;

            appState.map.setView([lat, lng], 15);
            
            const marker = MapService.createMarker(
                lat, lng, 'blue', 
                `📍 You are here<br><small>Accuracy: ±${Math.round(accuracy)}m</small>`
            );
            marker.addTo(appState.map).openPopup();

            // Add accuracy circle
            L.circle([lat, lng], {
                radius: accuracy,
                color: '#007bff',
                fillColor: '#007bff',
                fillOpacity: 0.1,
                weight: 1
            }).addTo(appState.map);

            notificationSystem.show('Location found successfully!', 'success', CONFIG.notifications.durations.short);

        } catch (error) {
            notificationSystem.hideLoading();
            ErrorHandler.handleGeolocationError(error);
            notificationSystem.show('Using default location (Sri Lanka)', 'info', CONFIG.notifications.durations.medium);
        }
    }
}

class TrackPageController {
    static async init() {
        const destination = sessionStorage.getItem("destination");
        if (!destination) {
            notificationSystem.show('No destination set. Redirecting to home...', 'warning');
            setTimeout(() => window.location.href = "index.html", 2000);
            return;
        }

        const loadingId = notificationSystem.showLoading('Finding your destination...');
        
        try {
            await this.trackDestination(destination);
            notificationSystem.hideLoading();
        } catch (error) {
            notificationSystem.hideLoading();
            ErrorHandler.handleNetworkError(error, 'while initializing tracking');
        }
    }

    static async trackDestination(destination) {
        try {
            const data = await LocationService.geocodeDestination(destination);
            
            if (data && data[0]) {
                appState.destLat = parseFloat(data[0].lat);
                appState.destLng = parseFloat(data[0].lon);
                
                await this.initMapWithTracking();
                
                const statusEl = document.getElementById("status");
                if (statusEl) statusEl.innerText = `Tracking to: ${destination}`;
                
                notificationSystem.show('Tracking started successfully!', 'success', CONFIG.notifications.durations.short, true);
                appState.trackingStartTime = new Date();
            } else {
                throw new Error('Destination not found');
            }
        } catch (error) {
            console.error("Geocoding error:", error);
            const statusEl = document.getElementById("status");
            if (statusEl) statusEl.innerText = "Unable to find destination";
            
            notificationSystem.show('Destination not found. Please try a different location.', 'error', CONFIG.notifications.durations.long);
            
            setTimeout(() => {
                window.location.href = "index.html";
            }, 3000);
        }
    }

    static async initMapWithTracking() {
        appState.map = MapService.initializeMap('map');

        // Add destination marker
        appState.destMarker = MapService.createMarker(
            appState.destLat, appState.destLng, 'red', '🎯 Destination'
        );
        appState.destMarker.addTo(appState.map).openPopup();

        // Start position tracking
        TrackingService.startPositionTracking();
    }
}

class HistoryPageController {
    static init() {
        this.loadTripHistory();
    }

    static loadTripHistory() {
        try {
            const trips = JSON.parse(localStorage.getItem("tripHistory")) || [];
            const list = document.getElementById("history-list");

            if (!list) return;

            if (trips.length === 0) {
                this.displayEmptyState(list);
                return;
            }

            this.displayTrips(trips, list);

        } catch (error) {
            console.error('Error loading trip history:', error);
            this.displayErrorState();
        }
    }

    static displayEmptyState(list) {
        list.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6c757d;">
                <div style="font-size: 48px; margin-bottom: 20px;">🗺️</div>
                <h3>No trips recorded yet</h3>
                <p>Your completed journeys will appear here</p>
            </div>
        `;
    }

    static displayErrorState() {
        const list = document.getElementById("history-list");
        if (list) {
            list.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545;">
                    <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                    <h3>Error loading trip history</h3>
                    <p>Please try refreshing the page</p>
                </div>
            `;
        }
        notificationSystem.show('Failed to load trip history', 'error');
    }

    static displayTrips(trips, list) {
        // Group trips by date
        const groupedTrips = trips.reduce((groups, trip) => {
            const date = trip.date || new Date(trip.timestamp).toLocaleDateString();
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(trip);
            return groups;
        }, {});

        list.innerHTML = "";

        // Create statistics summary
        this.createStatsSection(trips, list);

        // Add slide-in animation CSS
        this.addAnimationStyles();

        // Render grouped trips
        Object.keys(groupedTrips).forEach((date, dateIndex) => {
            this.createDateSection(date, groupedTrips[date], list, dateIndex);
        });
    }

    static createStatsSection(trips, list) {
        const totalTrips = trips.length;
        const totalDistance = trips.reduce((sum, trip) => sum + trip.distance, 0);
        const totalDuration = trips.reduce((sum, trip) => sum + (trip.duration || 0), 0);
        
        const statsDiv = document.createElement("div");
        statsDiv.style.cssText = `
            background: linear-gradient(135deg, #007bff, #0056b3);
            color: white;
            padding: 20px;
            border-radius: 15px;
            margin-bottom: 30px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 20px;
            text-align: center;
        `;
        
        statsDiv.innerHTML = `
            <div>
                <div style="font-size: 24px; font-weight: bold;">${totalTrips}</div>
                <div style="font-size: 12px; opacity: 0.9;">Total Trips</div>
            </div>
            <div>
                <div style="font-size: 24px; font-weight: bold;">${totalDistance.toFixed(1)} km</div>
                <div style="font-size: 12px; opacity: 0.9;">Distance Traveled</div>
            </div>
            <div>
                <div style="font-size: 24px; font-weight: bold;">${Math.round(totalDuration)} min</div>
                <div style="font-size: 12px; opacity: 0.9;">Travel Time</div>
            </div>
        `;
        
        list.appendChild(statsDiv);
    }

    static createDateSection(date, trips, list, dateIndex) {
        const dateHeader = document.createElement("h4");
        dateHeader.textContent = date;
        dateHeader.style.cssText = `
            color: #495057;
            font-size: 16px;
            margin: 30px 0 15px 0;
            padding-bottom: 8px;
            border-bottom: 2px solid #dee2e6;
            position: sticky;
            top: 0;
            background: white;
            z-index: 10;
        `;
        list.appendChild(dateHeader);

        trips.forEach((trip, index) => {
            this.createTripItem(trip, list, dateIndex, index);
        });
    }

    static createTripItem(trip, list, dateIndex, index) {
        const item = document.createElement("div");
        item.style.cssText = `
            background: linear-gradient(135deg, #ffffff, #f8f9fa);
            border: 1px solid #dee2e6;
            border-left: 4px solid #007bff;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            opacity: 0;
            transform: translateY(20px);
            animation: slideInUp 0.5s ease forwards;
            animation-delay: ${(dateIndex * 0.1) + (index * 0.05)}s;
        `;

        const duration = trip.duration ? `${trip.duration} min` : 'Unknown';
        const time = trip.time || new Date(trip.timestamp).toLocaleTimeString();

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; color: #2c3e50; font-size: 16px; margin-bottom: 5px;">
                        📍 ${Utils.escapeHtml(trip.destination)}
                    </div>
                    <div style="display: flex; gap: 15px; font-size: 14px; color: #6c757d;">
                        <span>🛣️ ${trip.distance} km</span>
                        <span>⏱️ ${duration}</span>
                        <span>🕐 ${time}</span>
                    </div>
                </div>
                <button onclick="repeatTrip('${Utils.escapeHtml(trip.destination)}')" style="
                    background: #007bff;
                    color: white;
                    border: none;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                " onmouseover="this.style.backgroundColor='#0056b3'" 
                   onmouseout="this.style.backgroundColor='#007bff'">
                    Repeat Trip
                </button>
            </div>
        `;

        // Add hover effects
        item.addEventListener('mouseenter', () => {
            item.style.transform = 'translateY(-2px)';
            item.style.boxShadow = '0 4px 15px rgba(0,0,0,0.15)';
        });

        item.addEventListener('mouseleave', () => {
            item.style.transform = 'translateY(0)';
            item.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        });

        list.appendChild(item);
    }

    static addAnimationStyles() {
        if (!document.getElementById('slide-animation')) {
            const style = document.createElement('style');
            style.id = 'slide-animation';
            style.textContent = `
                @keyframes slideInUp {
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
}

class SearchHistoryManager {
    constructor() {
        this.history = this.loadHistory();
        this.filteredHistory = [...this.history];
        this.init();
    }

    init() {
        this.renderHistory();
        this.updateStats();
        this.setupEventListeners();
        
        if (this.history.length > 0) {
            notificationSystem.show('Search history loaded successfully!', 'success');
        }
    }

    loadHistory() {
        try {
            const stored = JSON.parse(localStorage.getItem('searchHistory') || '[]');
            return stored.map(item => {
                if (typeof item === 'string') {
                    return {
                        query: item,
                        timestamp: new Date().toISOString(),
                        id: Utils.generateId()
                    };
                }
                return {
                    ...item,
                    id: item.id || Utils.generateId()
                };
            });
        } catch (error) {
            notificationSystem.show('Error loading search history', 'error');
            return [];
        }
    }

    saveHistory() {
        try {
            localStorage.setItem('searchHistory', JSON.stringify(this.history));
        } catch (error) {
            notificationSystem.show('Error saving search history', 'error');
        }
    }

    addSearch(query) {
        const newSearch = {
            query: query.trim(),
            timestamp: new Date().toISOString(),
            id: Utils.generateId()
        };
        
        this.history.unshift(newSearch);
        this.saveHistory();
        this.renderHistory();
        this.updateStats();
        notificationSystem.show(`Added "${query}" to search history`, 'success');
    }

    removeSearch(id) {
        const index = this.history.findIndex(item => item.id === id);
        if (index > -1) {
            const removed = this.history.splice(index, 1)[0];
            this.saveHistory();
            this.renderHistory();
            this.updateStats();
            notificationSystem.show(`Removed "${removed.query}" from history`, 'success');
        }
    }

    clearAllHistory() {
        if (this.history.length === 0) {
            notificationSystem.show('History is already empty', 'warning');
            return;
        }

        if (confirm('Are you sure you want to clear all search history? This action cannot be undone.')) {
            this.history = [];
            this.saveHistory();
            this.renderHistory();
            this.updateStats();
            notificationSystem.show('All search history cleared', 'success');
        }
    }

    filterHistory(query) {
        this.filteredHistory = this.history.filter(item =>
            item.query.toLowerCase().includes(query.toLowerCase())
        );
        this.renderHistory();
        
        if (query && this.filteredHistory.length === 0) {
            notificationSystem.show('No matches found for your search', 'warning');
        }
    }

    renderHistory() {
        const container = document.getElementById('searchHistoryList');
        if (!container) return;
        
        if (this.filteredHistory.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <h3>No Search History</h3>
                    <p>Your search history will appear here when you start using the GPS Alarm.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.filteredHistory.map((item, index) => `
            <div class="history-item" style="animation-delay: ${index * 0.1}s">
                <div class="search-text">
                    <i class="fas fa-map-marker-alt" style="color: #007bff; margin-right: 0.5rem;"></i>
                    ${Utils.escapeHtml(item.query)}
                </div>
                <div class="search-meta">
                    <div class="search-time">
                        <i class="fas fa-clock"></i>
                        <span>${Utils.formatTimestamp(item.timestamp)}</span>
                    </div>
                    <div class="search-actions">
                        <button class="action-btn repeat" onclick="historyManager.repeatSearch('${item.id}')">
                            <i class="fas fa-redo"></i> Search Again
                        </button>
                        <button class="action-btn delete" onclick="historyManager.removeSearch('${item.id}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    repeatSearch(id) {
        const item = this.history.find(h => h.id === id);
        if (item) {
            notificationSystem.show(`Redirecting to search for "${item.query}"`, 'info');
            setTimeout(() => {
                window.location.href = `index.html?search=${encodeURIComponent(item.query)}`;
            }, 1000);
        }
    }

    updateStats() {
        const totalElement = document.getElementById('totalSearches');
        const todayElement = document.getElementById('todaySearches');
        const uniqueElement = document.getElementById('uniqueSearches');

        if (!totalElement || !todayElement || !uniqueElement) return;

        const total = this.history.length;
        totalElement.textContent = total;

        // Count today's searches
        const today = new Date().toDateString();
        const todayCount = this.history.filter(item => 
            new Date(item.timestamp).toDateString() === today
        ).length;
        todayElement.textContent = todayCount;

        // Count unique searches
        const uniqueQueries = new Set(this.history.map(item => item.query.toLowerCase()));
        const uniqueCount = uniqueQueries.size;
        uniqueElement.textContent = uniqueCount;

        // Animate counters
        this.animateCounter(totalElement, total);
        this.animateCounter(todayElement, todayCount);
        this.animateCounter(uniqueElement, uniqueCount);
    }

    animateCounter(element, target) {
        let current = 0;
        const increment = target / 20;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                element.textContent = target;
                clearInterval(timer);
            } else {
                element.textContent = Math.floor(current);
            }
        }, 50);
    }

    setupEventListeners() {
        // Search filter
        const searchFilter = document.getElementById('searchFilter');
        if (searchFilter) {
            searchFilter.addEventListener('input', (e) => {
                this.filterHistory(e.target.value);
            });
        }

        // Clear history button
        const clearBtn = document.getElementById('clearHistoryBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearAllHistory();
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'f') {
                    e.preventDefault();
                    if (searchFilter) searchFilter.focus();
                } else if (e.key === 'Delete') {
                    e.preventDefault();
                    this.clearAllHistory();
                }
            }
        });
    }
}

// =============================================================================
// SYSTEM MONITORING
// =============================================================================

class SystemMonitor {
    static init() {
        this.checkOnlineStatus();
        this.monitorBattery();
        this.monitorPerformance();
    }

    static checkOnlineStatus() {
        const handleOnline = () => {
            notificationSystem.show('Connection restored! 🌐', 'success', CONFIG.notifications.durations.short);
        };

        const handleOffline = () => {
            notificationSystem.show('You are offline. Some features may not work. 📡', 'warning', CONFIG.notifications.durations.long);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        if (!navigator.onLine) {
            handleOffline();
        }
    }

    static async monitorBattery() {
        if ('getBattery' in navigator) {
            try {
                const battery = await navigator.getBattery();
                
                const updateBatteryStatus = () => {
                    if (battery.level < 0.2 && !battery.charging) {
                        notificationSystem.show(
                            `Low battery: ${Math.round(battery.level * 100)}%. Consider charging your device. 🔋`,
                            'warning',
                            CONFIG.notifications.durations.medium
                        );
                    }
                };

                battery.addEventListener('levelchange', updateBatteryStatus);
                battery.addEventListener('chargingchange', updateBatteryStatus);
                
                updateBatteryStatus();
            } catch (error) {
                console.log('Battery API not supported:', error);
            }
        }
    }

    static monitorPerformance() {
        if ('connection' in navigator) {
            const connection = navigator.connection;
            
            if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
                notificationSystem.show(
                    'Slow internet connection detected. App may be slower than usual. 🌐',
                    'info',
                    CONFIG.notifications.durations.medium
                );
            }
        }
    }
}

// =============================================================================
// AUTHENTICATION & USER MANAGEMENT
// =============================================================================

class AuthManager {
    static updateLoginStatus() {
        const loginLink = document.getElementById("loginNavLink");
        if (!loginLink) return;

        try {
            const loggedInUser = sessionStorage.getItem("loggedInUser");

            if (loggedInUser) {
                loginLink.innerHTML = `<i class="fas fa-user"></i> Profile`;
                loginLink.href = "profile.html";
                loginLink.title = `Logged in as ${loggedInUser}`;
                
                loginLink.style.background = 'linear-gradient(135deg, #28a745, #20c997)';
                loginLink.style.borderRadius = '20px';
                loginLink.style.padding = '8px 15px';
                loginLink.style.color = 'white';
                loginLink.style.textDecoration = 'none';
                
            } else {
                loginLink.innerHTML = `<i class="fas fa-sign-in-alt"></i> Log In`;
                loginLink.href = "login.html";
                loginLink.title = "Click to log in";
                
                loginLink.style.background = 'none';
                loginLink.style.borderRadius = 'none';
                loginLink.style.padding = 'none';
                loginLink.style.color = '';
            }
        } catch (error) {
            console.error('Error updating login status:', error);
        }
    }
}

// =============================================================================
// SLIDESHOW MANAGEMENT
// =============================================================================

class SlideshowManager {
    constructor() {
        this.currentSlide = 0;
        this.slides = document.querySelectorAll('.bg-slide');
        this.init();
    }

    init() {
        if (this.slides.length === 0) return;
        
        this.showSlide(0);
        setInterval(() => this.nextSlide(), 4000);
    }

    showSlide(index) {
        this.slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === index);
        });
    }

    nextSlide() {
        this.currentSlide = (this.currentSlide + 1) % this.slides.length;
        this.showSlide(this.currentSlide);
    }
}

// =============================================================================
// GLOBAL FUNCTIONS FOR HTML ONCLICK HANDLERS
// =============================================================================

function repeatTrip(destination) {
    notificationSystem.show(`Setting destination to: ${destination}`, 'info');
    sessionStorage.setItem("destination", destination);
    
    setTimeout(() => {
        window.location.href = "track.html";
    }, 1000);
}

// =============================================================================
// APPLICATION INITIALIZATION
// =============================================================================

class App {
    static async init() {
        // Initialize notification system
        window.notificationSystem = new NotificationSystem();
        await window.notificationSystem.init();

        // Initialize system monitoring
        SystemMonitor.init();

        // Initialize authentication
        AuthManager.updateLoginStatus();

        // Initialize slideshow if slides exist
        new SlideshowManager();

        // Initialize page-specific controllers
        this.initializePageControllers();

        // Setup global event listeners
        this.setupGlobalEventListeners();

        // Expose global objects
        this.exposeGlobals();
    }

    static initializePageControllers() {
        const currentPage = window.location.pathname;

        if (document.getElementById("home-map")) {
            HomePageController.init();
        }

        if (currentPage.includes("track.html") || document.getElementById("map")) {
            TrackPageController.init();
        }

        if (document.getElementById("history-list")) {
            HistoryPageController.init();
        }

        if (document.getElementById("searchHistoryList")) {
            window.historyManager = new SearchHistoryManager();
        }
    }

    static setupGlobalEventListeners() {
        // Clean up on page unload
        window.addEventListener('beforeunload', () => {
            TrackingService.stopTracking();
            if (window.notificationSystem) {
                window.notificationSystem.clear();
                window.notificationSystem.releaseWakeLock();
            }
        });

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Page is hidden
                console.log('App went to background');
            } else {
                // Page is visible
                console.log('App came to foreground');
                if (appState.isTracking) {
                    // Resume tracking if needed
                    TrackingService.startPositionTracking();
                }
            }
        });
    }

    static exposeGlobals() {
        // Expose necessary functions and objects globally for HTML onclick handlers
        window.repeatTrip = repeatTrip;
        window.appState = appState;
        window.TrackingService = TrackingService;
        window.StorageService = StorageService;
        window.ErrorHandler = ErrorHandler;
        window.Utils = Utils;
    }
}

// =============================================================================
// Profile Page
// =============================================================================

function logout() {
    sessionStorage.removeItem("loggedInUser");
    window.location.href = "login.html";
    }

    document.addEventListener("DOMContentLoaded", () => {
        const usernameDisplay = document.getElementById("usernameDisplay");
        const userEmailDisplay = document.getElementById("userEmailDisplay");
        const avatar = document.getElementById("avatar");
        const logoutBtn = document.getElementById("logoutBtn");

        const loggedInUser = sessionStorage.getItem("loggedInUser");
        if (!loggedInUser) 
            {
          window.location.href = "login.html";
          return;
        }

        usernameDisplay.textContent = loggedInUser;
        avatar.textContent = loggedInUser.charAt(0).toUpperCase();
        userEmailDisplay.textContent = `${loggedInUser.toLowerCase()}@example.com`;

        logoutBtn.addEventListener("click", logout);
    });


// =============================================================================
// START APPLICATION
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
    App.init();
});

