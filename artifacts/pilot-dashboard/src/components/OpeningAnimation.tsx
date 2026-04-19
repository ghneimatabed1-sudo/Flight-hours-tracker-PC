import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "@/lib/i18n";

/**
 * Hawk Eye opening animation.
 *
 * Plays once per browser tab (sessionStorage flag) on first paint of the
 * dashboard. Clean military aesthetic — emblem fades in over a dark
 * background, the "HAWK EYE" wordmark resolves above a hairline divider,
 * the bilingual tagline appears, then the whole overlay fades out.
 *
 * Skippable: tap / click anywhere or press Esc to dismiss immediately.
 * Total runtime ~3.0s if not skipped. Honors prefers-reduced-motion.
 */
const SESSION_KEY = "hawkeye.intro.played";

export default function OpeningAnimation() {
  const { lang } = useI18n();
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(SESSION_KEY) !== "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!visible) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduce ? 600 : 3000;
    const t = window.setTimeout(() => dismiss(), total);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* sessionStorage may be blocked — animation simply replays next mount */
    }
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="hawk-eye-intro"
          role="presentation"
          aria-label="Hawk Eye"
          onClick={dismiss}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background:
              "radial-gradient(circle at 50% 40%, #0f1a2e 0%, #050810 70%)",
            cursor: "pointer",
            color: "#e6c97a",
            fontFamily: "Inter, system-ui, sans-serif",
            userSelect: "none",
          }}
        >
          <motion.img
            src="brand/emblem.png"
            alt=""
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            style={{
              width: 128,
              height: 128,
              objectFit: "contain",
              marginBottom: 28,
              filter: "drop-shadow(0 4px 18px rgba(0,0,0,0.6))",
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
            style={{
              fontSize: 38,
              fontWeight: 700,
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              background:
                "linear-gradient(180deg, #f5d98a 0%, #b88a2e 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            HAWK EYE
          </motion.div>

          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.9, ease: "easeOut" }}
            style={{
              width: 220,
              height: 1,
              marginTop: 14,
              background:
                "linear-gradient(90deg, transparent 0%, rgba(230,201,122,0.7) 50%, transparent 100%)",
              transformOrigin: "center",
            }}
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.2, ease: "easeOut" }}
            style={{
              marginTop: 18,
              fontSize: 12,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: "rgba(230,201,122,0.78)",
              textAlign: "center",
              direction: lang === "ar" ? "rtl" : "ltr",
            }}
          >
            {lang === "ar"
              ? "عين الصقر · سلاح الجو الملكي الأردني"
              : "Royal Jordanian Air Force · Squadron Operations"}
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.6 }}
            style={{
              position: "absolute",
              bottom: 28,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            {lang === "ar" ? "اضغط للمتابعة" : "Tap to continue"}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
