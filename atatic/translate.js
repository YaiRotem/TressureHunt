(function () {
    const LANG_KEY = "th_lang_pref";
    const DEFAULT_LANG = "he";
    const BASE_LANG = "he";
    const TOGGLE_SELECTOR = "[data-lang-toggle]";

    let originalTextNodes = null;
    let originalAttrEntries = null;
    let translating = false;

    function getStoredLang() {
        try {
            return localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
        } catch (_) {
            return DEFAULT_LANG;
        }
    }

    function setStoredLang(lang) {
        try {
            localStorage.setItem(LANG_KEY, lang);
        } catch (_) {
            /* no-op */
        }
    }

    function setHtmlDirection(lang) {
        const dir = lang === "en" ? "ltr" : "rtl";
        document.documentElement.setAttribute("lang", lang);
        document.documentElement.setAttribute("dir", dir);
    }

    function highlightActive(lang) {
        document.querySelectorAll(TOGGLE_SELECTOR).forEach((el) => {
            if (el.getAttribute("data-lang-toggle") === lang) {
                el.classList.add("active");
            } else {
                el.classList.remove("active");
            }
        });
    }

    function collectTargets() {
        const targets = [];
        const textNodes = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node || !node.textContent) return NodeFilter.FILTER_REJECT;
                const text = node.textContent.trim();
                if (!text) return NodeFilter.FILTER_REJECT;
                const parentName = (node.parentNode && node.parentNode.nodeName) || "";
                if (["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "TEXTAREA", "INPUT", "SELECT", "OPTION"].includes(parentName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let current = walker.nextNode();
        while (current) {
            textNodes.push(current);
            current = walker.nextNode();
        }

        textNodes.forEach((node) => {
            targets.push({ kind: "text", node, text: node.textContent });
        });

        const inputs = Array.from(document.querySelectorAll("input, textarea"));
        inputs.forEach((el) => {
            if (el.hasAttribute("data-field")) return; // skip dynamic riddle editors
            const val = el.value;
            if (typeof val === "string" && val.trim()) {
                targets.push({ kind: "attr", node: el, attr: "value", text: val });
            }
            const ph = el.getAttribute("placeholder");
            if (typeof ph === "string" && ph.trim()) {
                targets.push({ kind: "attr", node: el, attr: "placeholder", text: ph });
            }
        });

        return targets;
    }

    function restoreOriginal() {
        if (originalTextNodes) {
            originalTextNodes.forEach(({ node, text }) => {
                if (node && node.textContent !== text) {
                    node.textContent = text;
                }
            });
        }
        if (originalAttrEntries) {
            originalAttrEntries.forEach(({ node, attr, value }) => {
                if (!node) return;
                if (attr === "value") {
                    node.value = value;
                }
                node.setAttribute(attr, value);
            });
        }
    }

    async function translateToEnglish() {
        if (translating) return;
        translating = true;

        const targets = collectTargets();
        if (!originalTextNodes) originalTextNodes = [];
        if (!originalAttrEntries) originalAttrEntries = [];

        const payloadTexts = [];
        targets.forEach((item) => {
            if (item.kind === "text") {
                if (!originalTextNodes.some((entry) => entry.node === item.node)) {
                    originalTextNodes.push({ node: item.node, text: item.text });
                }
            } else if (item.kind === "attr") {
                if (!originalAttrEntries.some((entry) => entry.node === item.node && entry.attr === item.attr)) {
                    originalAttrEntries.push({ node: item.node, attr: item.attr, value: item.text });
                }
            }
            payloadTexts.push(item.text);
        });

        try {
            const res = await fetch("/translate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ texts: payloadTexts, target: "en" })
            });
            const data = await res.json();
            if (!data.ok || !Array.isArray(data.translations)) {
                throw new Error(data.error || "Translate failed");
            }
            let tIndex = 0;
            targets.forEach((item) => {
                const translated = data.translations[tIndex++];
                if (typeof translated !== "string") return;
                if (item.kind === "text" && item.node) {
                    item.node.textContent = translated;
                } else if (item.kind === "attr" && item.node) {
                    if (item.attr === "value") {
                        item.node.value = translated;
                    }
                    item.node.setAttribute(item.attr, translated);
                }
            });
        } catch (e) {
            console.error("Translate error", e);
        } finally {
            translating = false;
        }
    }

    function applyLang(lang) {
        setHtmlDirection(lang);
        highlightActive(lang);
        try {
            window.dispatchEvent(new CustomEvent("th-lang-changed", { detail: { lang } }));
        } catch (_) {}
        if (lang === BASE_LANG) {
            restoreOriginal();
        } else {
            translateToEnglish();
        }
    }

    function initToggle() {
        const currentLang = getStoredLang();
        setHtmlDirection(currentLang);
        highlightActive(currentLang);

        document.querySelectorAll(TOGGLE_SELECTOR).forEach((btn) => {
            btn.addEventListener("click", () => {
                const target = btn.getAttribute("data-lang-toggle");
                if (!target) return;
                setStoredLang(target);
                applyLang(target);
            });
        });

        // Apply stored preference on load
        if (currentLang !== BASE_LANG) {
            applyLang(currentLang);
        }
    }

    // Expose a refresher so dynamically injected content (e.g., riddles) can be translated
    window.thRefreshTranslations = function thRefreshTranslations() {
        const lang = getStoredLang();
        if (lang && lang !== BASE_LANG) {
            applyLang(lang);
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initToggle);
    } else {
        initToggle();
    }
})();
