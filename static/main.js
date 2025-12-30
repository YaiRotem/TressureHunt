let map;
let marker = null;
let geocoder = null;
let riddleExpanded = true;
let riddleHideTimer = null;
let guideAnimator = null;
const successAudioCache = [];
const DEFAULT_AUDIO_VOLUME = 1.0;
const treasureAudio = new Audio("/static/assets/sounds/MyBrotherIsGettingMarried.mp3");
treasureAudio.volume = DEFAULT_AUDIO_VOLUME;
const GUIDE_VIDEO_SOURCES = {
    walk: [
        "/static/assets/videos/Pirate_Transition_Walking_To_Waiting.webm",
    ],
    waiting: [
        "/static/assets/videos/Pirate_Transition_Walking_To_Waiting.webm",
    ],
    happy: [
        "/static/assets/videos/Pirate_Transition_Waiting_to_Happy.webm",
    ],
    sad: [
        "/static/assets/videos/Video_Transition_Waiting_to_Sad.webm",
    ],
};

function getRiddleToggleLabels(lang) {
    if (lang === "en") {
        return { show: "Show riddle", hide: "Hide riddle" };
    }
    return { show: "הצג חידה", hide: "הסתר חידה" };
}

function setRiddleExpanded(expanded) {
    riddleExpanded = expanded;
    const panel = document.getElementById("riddle-panel");
    const toggle = document.getElementById("riddle-toggle");
    const lang = (document.documentElement && document.documentElement.getAttribute("lang")) || "he";
    const labels = getRiddleToggleLabels(lang);
    if (riddleHideTimer) {
        clearTimeout(riddleHideTimer);
        riddleHideTimer = null;
    }
    if (expanded) {
        document.body.classList.remove("riddle-collapsed");
        if (panel) {
            panel.classList.remove("riddle-hide");
            panel.classList.remove("riddle-reveal");
            // trigger reflow so animation restarts
            void panel.offsetWidth;
            panel.classList.add("riddle-reveal");
        }
    } else {
        if (panel) {
            panel.classList.remove("riddle-reveal");
            panel.classList.add("riddle-hide");
        }
        // delay collapsing to let hide animation play
        riddleHideTimer = setTimeout(() => {
            document.body.classList.add("riddle-collapsed");
            if (panel) panel.classList.remove("riddle-hide");
        }, 320);
    }
    if (toggle) {
        toggle.textContent = expanded ? labels.hide : labels.show;
    }

    // Translate updated labels if the user is in English
    if (typeof window !== "undefined" && window.thRefreshTranslations) {
        window.thRefreshTranslations();
    }
}

// Update riddle toggle label when language changes
window.addEventListener("th-lang-changed", (evt) => {
    const lang = (evt && evt.detail && evt.detail.lang) || (document.documentElement && document.documentElement.getAttribute("lang")) || "he";
    const toggle = document.getElementById("riddle-toggle");
    if (!toggle) return;
    const labels = getRiddleToggleLabels(lang);
    toggle.textContent = riddleExpanded ? labels.hide : labels.show;
});

// ---------- Guide character (video transitions) ----------

function createGuideAnimator() {
    const wrapper = document.getElementById("guide-wrapper");
    const primaryEl = document.getElementById("guide-video-primary");
    const bufferEl = document.getElementById("guide-video-buffer");
    const fallbackEl = primaryEl || bufferEl;
    if (!fallbackEl) return null;

    [primaryEl, bufferEl].forEach((vid) => {
        if (!vid) return;
        vid.muted = true;
        vid.playsInline = true;
        vid.setAttribute("aria-hidden", "true");
        vid.preload = "auto";
    });

    let activeEl = primaryEl || fallbackEl;
    let standbyEl = bufferEl || fallbackEl;
    let currentKey = null;
    let pendingMetadataHandler = null;
    const preloadCache = {};

    function pickBestSource(files) {
        if (!Array.isArray(files) || !files.length) return null;
        const testEl = activeEl || fallbackEl;
        const prefersWebm = testEl.canPlayType("video/webm");
        if (prefersWebm) {
            const webm = files.find((f) => f.endsWith(".webm"));
            if (webm) return webm;
        }
        const mp4 = files.find((f) => f.endsWith(".mp4"));
        return mp4 || files[0];
    }

    function preload(key) {
        if (preloadCache[key]) return preloadCache[key];
        const files = GUIDE_VIDEO_SOURCES[key];
        const src = pickBestSource(files);
        if (!src) return null;
        const vid = document.createElement("video");
        vid.preload = "auto";
        vid.muted = true;
        vid.playsInline = true;
        vid.src = src;
        vid.load();
        preloadCache[key] = vid;
        return vid;
    }

    function play(key, options = {}) {
        const { loop = false, startAtEnd = false, loopFromTail = false, onEnded = null } = options;
        const files = GUIDE_VIDEO_SOURCES[key];
        if (!files) return;

        const bestSrc = pickBestSource(files);
        const preloaded = preload(key);
        const chosenSrc = (preloaded && (preloaded.currentSrc || preloaded.src)) || bestSrc || "";

        const targetEl = standbyEl || activeEl;
        let targetReady = false;
        targetEl.style.visibility = "hidden";

        if (currentKey !== key || targetEl.getAttribute("data-current-src") !== chosenSrc) {
            currentKey = key;
            targetEl.setAttribute("data-current-src", chosenSrc);
            targetEl.src = chosenSrc;
            targetEl.load();
        }

        if (pendingMetadataHandler) {
            targetEl.removeEventListener("loadedmetadata", pendingMetadataHandler);
            pendingMetadataHandler = null;
        }

        let swapped = false;
        const doSwap = () => {
            if (swapped || !targetReady) return;
            swapped = true;
            targetEl.style.visibility = "visible";
            if (standbyEl && standbyEl !== activeEl) {
                targetEl.classList.add("guide-active");
                activeEl.classList.remove("guide-active");
                const prevActive = activeEl;
                activeEl = targetEl;
                standbyEl = prevActive;
            } else {
                targetEl.classList.add("guide-active");
            }
        };

        const seekToTail = () => {
            const duration = targetEl.duration || 0;
            const seekTime = Math.max(duration - 1, 0);
            try {
                targetEl.currentTime = seekTime;
            } catch (e) {
                // Safe no-op if the browser blocks seeking before metadata
            }
        };

        targetEl.loop = loop;
        targetEl.onended = null;

        if (startAtEnd) {
            if (Number.isFinite(targetEl.duration) && targetEl.duration > 0) {
                seekToTail();
                targetReady = true;
                doSwap();
            } else {
                pendingMetadataHandler = () => {
                    seekToTail();
                    targetReady = true;
                    doSwap();
                    pendingMetadataHandler = null;
                };
                targetEl.addEventListener("loadedmetadata", pendingMetadataHandler, { once: true });
            }
        } else {
            targetEl.currentTime = 0;
            targetReady = true;
            doSwap();
        }

        if (loopFromTail) {
            targetEl.loop = false;
            targetEl.onended = () => {
                seekToTail();
                targetEl.play().catch(() => {});
            };
        } else if (onEnded) {
            targetEl.onended = onEnded;
        }

        targetEl.addEventListener("playing", doSwap, { once: true });
        targetEl.addEventListener("canplay", doSwap, { once: true });
        // Fallback swap if neither event fires quickly
        setTimeout(doSwap, 120);

        const playPromise = targetEl.play();
        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
        }
    }

    function playWaitingLoop() {
        play("waiting", { loopFromTail: true, startAtEnd: true });
    }

    return {
        walkIn: () => {
            play("walk", { onEnded: playWaitingLoop });
            if (wrapper) {
                requestAnimationFrame(() => wrapper.classList.add("guide-arrived"));
            }
        },
        happy: () => play("happy", { onEnded: playWaitingLoop }),
        sad: () => play("sad", { onEnded: playWaitingLoop }),
        waiting: playWaitingLoop,
    };
}

// ---------- Confetti helpers ----------

// Small/medium confetti for each correct riddle (not final treasure)
function fireSmallConfetti() {
    if (typeof confetti !== "function") return;

    confetti({
        particleCount: 80,
        spread: 60,
        startVelocity: 35,
        gravity: 0.9,
        origin: { x: 0.5, y: 0.6 } // center-ish
    });
}

// Big confetti storm for the final treasure
function fireBigConfetti() {
    if (typeof confetti !== "function") return;

    // Center burst
    confetti({
        particleCount: 200,
        spread: 100,
        startVelocity: 45,
        gravity: 0.8,
        origin: { x: 0.5, y: 0.7 }
    });

    // Side bursts
    confetti({
        particleCount: 80,
        spread: 70,
        startVelocity: 35,
        gravity: 0.9,
        origin: { x: 0.1, y: 0.7 }
    });

    confetti({
        particleCount: 80,
        spread: 70,
        startVelocity: 35,
        gravity: 0.9,
        origin: { x: 0.9, y: 0.7 }
    });
}

// ---------- Popup (regular messages, not treasure) ----------

function showPopup(message) {
    const overlay = document.getElementById("popup-overlay");
    const msgEl = document.getElementById("popup-message");
    msgEl.textContent = message;
    overlay.style.display = "flex";
}

function hidePopup() {
    const overlay = document.getElementById("popup-overlay");
    overlay.style.display = "none";
}

// ---------- Celebration (treasure found) ----------

function showCelebration(message) {
    const overlay = document.getElementById("celebration-overlay");
    const textEl = document.getElementById("celebration-text");

    if (message) {
        textEl.textContent = message;
    }

    overlay.style.display = "flex";
}

function hideCelebration() {
    const overlay = document.getElementById("celebration-overlay");
    overlay.style.display = "none";
}

// ---------- INIT MAP ----------

function initMap() {
    const center = { lat: 32.0853, lng: 34.7818 }; // Tel Aviv center example

    map = new google.maps.Map(document.getElementById("map"), {
        center: center,
        zoom: 14,
    });

    geocoder = new google.maps.Geocoder();

    guideAnimator = createGuideAnimator();
    if (guideAnimator) {
        guideAnimator.walkIn();
    }

    // Riddle toggle handlers
    const riddleToggle = document.getElementById("riddle-toggle");
    const riddlePanel = document.getElementById("riddle-panel");
    setRiddleExpanded(true); // show full riddle on load

    if (riddleToggle) {
        riddleToggle.addEventListener("click", (event) => {
            event.stopPropagation();
            setRiddleExpanded(!riddleExpanded);
        });
    }

    // Collapse when clicking outside the riddle area (but ignore popups/overlays)
    document.addEventListener("click", (event) => {
        if (!riddleExpanded) return;

        const popupOverlay = document.getElementById("popup-overlay");
        const celebrationOverlay = document.getElementById("celebration-overlay");

        const clickedInRiddle = riddlePanel && riddlePanel.contains(event.target);
        const clickedToggle = riddleToggle && riddleToggle.contains(event.target);
        const clickedPopup = popupOverlay && popupOverlay.contains(event.target);
        const clickedCelebration = celebrationOverlay && celebrationOverlay.contains(event.target);

        if (clickedInRiddle || clickedToggle || clickedPopup || clickedCelebration) {
            return;
        }

        setRiddleExpanded(false);
    });

    // Click on map: only choose a point, don't check answer yet
    map.addListener("click", (e) => {
        placeMarker(e.latLng);
        const statusEl = document.getElementById("status");
        statusEl.textContent = "x`x-x\"x¦x? xÿxxx\"x\" x›xo x\"xzxx\". xox-xÝx x›xo x'x-x\" x\"xÿxTx-xxc xcxoxTx' x>x\"xT xox`x\"xx.";
    });

    // Search button
    document.getElementById("search-button").addEventListener("click", () => {
        searchLocation(document.getElementById("search-input").value);
    });

    // Search on Enter
    document.getElementById("search-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            searchLocation(event.target.value);
        }
    });

    // Guess button
    document.getElementById("guess-button").addEventListener("click", () => {
        if (!marker) {
            showPopup("xxx\"x? x`x-x\"x xÿxxx\"x\" x›xo x\"xzxx\" xx?x- xÿx­x xcxx`.");
            return;
        }
        const pos = marker.getPosition();
        submitAnswer(pos.lat(), pos.lng());
    });

    // Close buttons
    document.getElementById("popup-close").addEventListener("click", hidePopup);
    document.getElementById("celebration-close").addEventListener("click", hideCelebration);
}

// ---------- MAP HELPERS ----------

function placeMarker(location) {
    if (marker) marker.setMap(null);
    marker = new google.maps.Marker({
        position: location,
        map: map,
    });
}

// Smooth camera animation to a target location (instead of instant jump)
function flyToLocation(targetLatLng, targetZoom = 15, durationMs = 1200) {
    if (!map) return;

    const startCenter = map.getCenter();
    const startZoom = map.getZoom();
    const startLat = startCenter.lat();
    const startLng = startCenter.lng();
    const endLat = targetLatLng.lat();
    const endLng = targetLatLng.lng();
    const zoomDelta = targetZoom - startZoom;
    const startTime = performance.now();

    function easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        const eased = easeInOutQuad(t);

        const lat = startLat + (endLat - startLat) * eased;
        const lng = startLng + (endLng - startLng) * eased;
        const zoom = startZoom + zoomDelta * eased;

        map.setCenter(new google.maps.LatLng(lat, lng));
        map.setZoom(zoom);

        if (t < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}

function playSuccessAudio(messageIndex, customSound) {
    if (typeof messageIndex !== "number") return;
    const sounds = (typeof window !== "undefined" && Array.isArray(window.SUCCESS_SOUNDS)) ? window.SUCCESS_SOUNDS : [];
    const rawPath = customSound || sounds[messageIndex] || `success${messageIndex + 1}.m4a`;
    const filePath = rawPath.startsWith("/") ? rawPath : `/static/assets/sounds/${rawPath}`;
    if (!successAudioCache[messageIndex]) {
        successAudioCache[messageIndex] = new Audio(filePath);
        successAudioCache[messageIndex].volume = DEFAULT_AUDIO_VOLUME;
    }
    const audio = successAudioCache[messageIndex];
    try {
        audio.currentTime = 0;
        audio.play();
    } catch (e) {
        console.warn("Could not play success audio", e);
    }
}

function searchLocation(query) {
    if (!query || !query.trim()) {
        showPopup("x?xÿx? x\"x-xTxÿx x~xx­x~ xox-xTxxxc.");
        return;
    }

    geocoder.geocode({ address: query }, (results, status) => {
        if (status === "OK" && results[0]) {
            const loc = results[0].geometry.location;
            flyToLocation(loc, 15, 1200);
            placeMarker(loc);
        } else {
            showPopup("xox? x\"xÝxox-x¦xT xoxzxÝxx? x?x¦ x\"xzxxx?. xÿx­x xcx? x?x-x\".");
        }
    });
}

// ---------- GAME LOGIC: SEND GUESS TO SERVER ----------

function submitAnswer(lat, lng) {
    const riddleTextEl = document.getElementById("riddle-text");
    const statusEl = document.getElementById("status");
    const searchInput = document.getElementById("search-input");

    const riddleId = parseInt(riddleTextEl.getAttribute("data-riddle-id"), 10);

    fetch("/check-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            riddle_id: riddleId,
            lat: lat,
            lng: lng,
        }),
    })
        .then((response) => response.json())
        .then((data) => {
            // --- CASE 1: FINAL TREASURE FOUND ---
            if (data.correct && data.finished) {
                // Update main riddle text immediately
                const finalText = (data && typeof data.message === "string" && data.message.trim())
                    ? data.message
                    : "You found the treasure!";
                // Hide the riddle and clear its content once the treasure is found
                riddleTextEl.textContent = "";
                riddleTextEl.setAttribute("data-riddle-id", "-1");
                setRiddleExpanded(false);
                if (typeof window !== "undefined" && window.thRefreshTranslations) {
                    window.thRefreshTranslations();
                }

                // Clear status + search bar
                statusEl.textContent = "";
                searchInput.value = "";

                // Make sure regular popup is not shown
                hidePopup();

                if (guideAnimator) {
                    guideAnimator.happy();
                }

                // Fire big confetti first
                fireBigConfetti();

                // Play treasure song
                try {
                    treasureAudio.currentTime = 0;
                    treasureAudio.play();
                } catch (e) {
                    console.warn("Could not play treasure audio", e);
                }

                // After confetti has mostly vanished, show celebration overlay
                // (timing in ms ƒ?" tweak if you want)
                setTimeout(() => {
                    showCelebration(data.message);
                }, 2200);

                return; // Important: stop here, don't show regular popup
            }

            // --- CASE 2: Not final treasure (either wrong or next riddle) ---

            // If incorrect guess ƒ+' no confetti, immediate popup
            if (!data.correct) {
                statusEl.textContent = data.message;
                showPopup(data.message);
                if (guideAnimator) {
                    guideAnimator.sad();
                }
                return;
            }

            // Correct but not finished:
            // 1) Update riddle & status immediately
            statusEl.textContent = data.message;
            playSuccessAudio(data.message_index, data.sound);
            if (guideAnimator) {
                guideAnimator.happy();
            }

            if (data.next_riddle) {
                riddleTextEl.textContent = data.next_riddle.text;
                riddleTextEl.setAttribute("data-riddle-id", data.next_riddle.id);
                setRiddleExpanded(true);
                if (typeof window !== "undefined" && window.thRefreshTranslations) {
                    window.thRefreshTranslations();
                }
            }

            // 2) Clear search field
            searchInput.value = "";

            // 3) Fire small confetti
            fireSmallConfetti();

            // 4) After confetti, show popup with success message
            setTimeout(() => {
                showPopup(data.message);
            }, 1200);
        })
        .catch(() => {
            showPopup("xcx'xTx?x\" x`x¦xxcxx\"x¦ x›x? x\"xcx\"x¦.");
        });
}
