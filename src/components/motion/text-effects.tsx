"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function BlurText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const words = text.split(" ");
  return (
    <span className={cn("inline-flex flex-wrap gap-x-1", className)}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          initial={{ opacity: 0, filter: "blur(8px)", y: 4 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.3 }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

export function TextMorph({ text, className }: { text: string; className?: string }) {
  return (
    <motion.span
      key={text}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className={cn("text-xs text-indigo-300", className)}
    >
      {text}
    </motion.span>
  );
}
