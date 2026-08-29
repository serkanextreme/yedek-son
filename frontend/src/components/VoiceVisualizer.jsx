import React from "react";
import { motion } from "framer-motion";

const VoiceVisualizer = ({ active = false, bars = 32 }) => {
  return (
    <div
      className="flex items-end justify-center gap-[3px] h-10 w-full"
      data-testid="voice-visualizer"
    >
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-sm bg-sertex-cyan"
          animate={{
            height: active
              ? [
                  `${20 + Math.random() * 30}%`,
                  `${40 + Math.random() * 60}%`,
                  `${15 + Math.random() * 25}%`,
                ]
              : "10%",
            opacity: active ? [0.5, 1, 0.6] : 0.3,
          }}
          transition={{
            duration: 0.5 + Math.random() * 0.6,
            repeat: Infinity,
            delay: i * 0.02,
            ease: "easeInOut",
          }}
          style={{ minHeight: 3, boxShadow: active ? "0 0 6px #00F0FF" : "none" }}
        />
      ))}
    </div>
  );
};

export default VoiceVisualizer;
