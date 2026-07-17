import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { api, type Weyn } from "../api";
import { settleSpring, staggerContainer, staggerChild } from "../motion";
import Stub from "../components/Stub";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ItineraryItem {
  event: Weyn;
  reasoning: string;
}

const EXAMPLE_PROMPTS = [
  "I'm free tomorrow",
  "Something romantic",
  "Under 15 OMR",
  "Good for kids",
  "Live music tonight",
];

export default function Concierge() {
  const nav = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ItineraryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Scroll to bottom when results change
  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }, 100);
    }
  }, [results, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setError(null);
    setLoading(true);

    // Add user message to chat history
    const newMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);

    try {
      // Call the concierge API
      const response = await api.askConcierge(userMessage, {
        messages: newMessages,
      });

      // response should contain { itinerary: ItineraryItem[], reasoning: string }
      if (response.itinerary && Array.isArray(response.itinerary)) {
        setResults(response.itinerary);
        setMessages([
          ...newMessages,
          {
            role: "assistant",
            content: response.reasoning || "Found some great events for you!",
          },
        ]);
      } else {
        setError("No results found. Try a different request.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError("Could not get recommendations. Please try again.");
      console.error("Concierge error:", err);
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.focus();
    }
  }

  function handleChipClick(prompt: string) {
    setInput(prompt);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="concierge-page">
      {/* Header */}
      <div className="concierge-header">
        <div className="concierge-title-row">
          <button className="concierge-back" onClick={() => nav(-1)} aria-label="Go back">
            <i className="icon-arrow-left" />
          </button>
          <h1 className="concierge-title">Ask our AI Concierge</h1>
          <div style={{ width: 40 }} /> {/* balance the back button */}
        </div>
      </div>

      {/* Content area */}
      <div className="concierge-content" ref={scrollRef}>
        {/* Example prompts (show before first message) */}
        {messages.length === 0 && !loading && (
          <motion.div
            className="concierge-intro"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={settleSpring}
          >
            <p className="concierge-intro-text">Tell us what you're looking for</p>
            <div className="concierge-chips">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="concierge-chip"
                  onClick={() => handleChipClick(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Results itinerary */}
        {results.length > 0 && (
          <motion.div
            className="concierge-results"
            variants={staggerContainer}
            initial="initial"
            animate="animate"
          >
            {results.map((item, idx) => (
              <motion.div key={item.event.id} variants={staggerChild} className="concierge-result-item">
                <Stub e={item.event} variant="card" />
                <p className="concierge-reasoning">{item.reasoning}</p>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="concierge-skeletons">
            {[0, 1, 2].map((i) => (
              <div key={i} className="concierge-skeleton-item">
                <div className="skel-cover" style={{ aspectRatio: "16/9" }} />
                <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="sk sk-line" style={{ width: "100%", height: 16 }} />
                  <span className="sk sk-line" style={{ width: "80%", height: 14 }} />
                  <span className="sk sk-line" style={{ width: "60%", height: 12 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error message */}
        {error && (
          <motion.div
            className="concierge-error"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={settleSpring}
          >
            <p>{error}</p>
            <button className="concierge-error-retry" onClick={() => setError(null)}>
              Dismiss
            </button>
          </motion.div>
        )}
      </div>

      {/* Input area - sticky at bottom */}
      <form className="concierge-input-area" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="concierge-input"
          placeholder="Describe your perfect event..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          maxLength={200}
        />
        <button
          type="submit"
          className={"concierge-submit" + (loading ? " loading" : "")}
          disabled={!input.trim() || loading}
          aria-label="Submit"
        >
          <i className="icon-arrow-right" />
        </button>
      </form>
    </div>
  );
}
