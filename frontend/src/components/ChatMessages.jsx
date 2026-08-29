import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../lib/auth";
import RechartsChart from "./RechartsChart";

const TypewriterText = ({ text, speed = 15 }) => {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    setDisplayed("");
    let i = 0;
    const chars = Array.from(text);
    const interval = setInterval(() => {
      i++;
      setDisplayed(chars.slice(0, i).join(""));
      if (i >= chars.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);
  return <span>{displayed}</span>;
};

const ChatMessages = ({ messages, thinking }) => {
  const { user } = useAuth();
  const bottomRef = useRef(null);
  const userLabel = (user?.username || "kullanıcı").toUpperCase();
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div
      className="w-full max-h-[42vh] overflow-y-auto scrollbar-sertex px-2 py-2 space-y-3"
      data-testid="chat-messages"
    >
      <AnimatePresence initial={false}>
        {messages.map((m, idx) => {
          const isUser = m.role === "user";
          const isLastAssistant =
            !isUser && idx === messages.length - 1;
          const sources = !isUser ? m.sources || [] : [];
          return (
            <motion.div
              key={m.id || idx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              data-testid={`msg-${m.role}`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 border ${
                  isUser
                    ? "bg-sertex-blue/10 border-sertex-blue/40 text-sertex-text rounded-md rounded-tr-none"
                    : "bg-sertex-cyan/5 border-sertex-cyan/30 text-sertex-text rounded-md rounded-tl-none"
                }`}
              >
                <div className="hud-text mb-1 opacity-70">
                  {isUser ? userLabel : "SERTEX"}
                </div>
                <div className="text-sm font-mono leading-relaxed whitespace-pre-wrap">
                  {isLastAssistant ? (
                    <TypewriterText text={m.content} />
                  ) : (
                    m.content
                  )}
                </div>
                {m.chart && Array.isArray(m.chart.data) && m.chart.data.length > 0 && (
                  <div
                    className="mt-3 pt-2 border-t border-sertex-cyan/20"
                    data-testid={`msg-chart-${m.id || idx}`}
                  >
                    {m.chart.title && (
                      <div className="hud-text text-sertex-cyan mb-1">
                        {m.chart.title}
                      </div>
                    )}
                    <div className="bg-sertex-bg/30 rounded-md p-2">
                      <RechartsChart
                        type={m.chart.type || "bar"}
                        data={m.chart.data}
                        xLabel={m.chart.x_label || "x"}
                        yLabel={m.chart.y_label || "y"}
                      />
                    </div>
                    {m.chart.filename && (
                      <div className="text-[9px] font-mono text-sertex-textMuted mt-1 text-right">
                        {m.chart.filename}
                        {m.chart.sheet ? ` · ${m.chart.sheet}` : ""}
                      </div>
                    )}
                  </div>
                )}
                {sources.length > 0 && (
                  <div
                    className="mt-2 pt-2 border-t border-sertex-cyan/20 flex flex-wrap gap-1"
                    data-testid={`msg-sources-${m.id || idx}`}
                  >
                    <span className="hud-text text-[9px] text-sertex-cyan opacity-80 mr-1">
                      KAYNAKLAR
                    </span>
                    {sources.map((s, i) => (
                      <span
                        key={`${s.file_id}-${s.chunk_index}-${i}`}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sertex-cyan/10 border border-sertex-cyan/30 text-sertex-cyan"
                        title={`Parça #${s.chunk_index} · benzerlik ${(s.score * 100).toFixed(0)}%`}
                      >
                        {s.filename}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
        {thinking && (
          <motion.div
            key="thinking"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex justify-start"
            data-testid="thinking-indicator"
          >
            <div className="px-3 py-2 border border-sertex-cyan/30 bg-sertex-cyan/5 rounded-md rounded-tl-none">
              <div className="hud-text opacity-70 flex items-center gap-1">
                SERTEX
                <span className="inline-flex gap-1 ml-2">
                  <span className="w-1 h-1 bg-sertex-cyan rounded-full animate-pulse" />
                  <span className="w-1 h-1 bg-sertex-cyan rounded-full animate-pulse [animation-delay:0.2s]" />
                  <span className="w-1 h-1 bg-sertex-cyan rounded-full animate-pulse [animation-delay:0.4s]" />
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div ref={bottomRef} />
    </div>
  );
};

export default ChatMessages;
