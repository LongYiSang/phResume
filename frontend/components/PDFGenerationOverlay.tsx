"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

interface PDFGenerationOverlayProps {
  isVisible: boolean;
  progress: number; // 0 to 100
}

export function PDFGenerationOverlay({
  isVisible,
  progress,
}: PDFGenerationOverlayProps) {
  const [showCompletion, setShowCompletion] = useState(false);

  useEffect(() => {
    if (progress >= 100) {
      setShowCompletion(true);
      const timer = setTimeout(() => setShowCompletion(false), 2000); // Reset after animation
      return () => clearTimeout(timer);
    } else {
      setShowCompletion(false);
    }
  }, [progress]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white/80 backdrop-blur-md"
        >
          {/* Central Content */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="flex flex-col items-center gap-8 p-8 rounded-[32px] bg-white shadow-2xl border border-kawaii-pinkLight/50 min-w-[320px]"
          >
            {/* Circular Loader / Success Icon */}
            <div className="relative w-24 h-24 flex items-center justify-center">
              <AnimatePresence mode="wait">
                {progress < 100 ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0, rotate: -90 }}
                    animate={{ opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.3 }}
                    className="relative w-full h-full"
                  >
                    {/* Spinning Circle */}
                    <svg
                      className="w-full h-full animate-spin-slow"
                      viewBox="0 0 100 100"
                    >
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="#fce7f3" // kawaii-pinkLight
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="#fb7185" // kawaii-pink
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray="283"
                        strokeDashoffset="200"
                        className="opacity-80"
                      />
                    </svg>
                    {/* Cute Icon in center */}
                    <div className="absolute inset-0 flex items-center justify-center text-3xl animate-bounce">
                      ✨
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="success"
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="text-kawaii-mint text-6xl"
                  >
                    🎉
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Progress Bar & Text */}
            <div className="w-full flex flex-col items-center gap-3">
              <div className="w-64 h-4 bg-kawaii-pinkLight/30 rounded-full overflow-hidden p-1">
                <motion.div
                  className="h-full bg-gradient-to-r from-kawaii-pink to-kawaii-purple rounded-full shadow-sm"
                  initial={{ width: "0%" }}
                  animate={{ width: `${progress}%` }}
                  transition={{ type: "spring", stiffness: 50, damping: 20 }}
                />
              </div>
              <motion.span
                key={progress < 100 ? "generating" : "done"}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-kawaii-text font-bold text-lg font-display"
              >
                {progress < 100 ? "正在生成PDF..." : "生成完成！"}
              </motion.span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
