import { useEffect, useState } from "react";
import { api } from "../api";

export interface EventAttendee {
  name: string | null;
  initials?: string;
}

export default function WhosGoing({ eventId, currentUserId }: { eventId: string; currentUserId?: string | null }) {
  const [attendees, setAttendees] = useState<EventAttendee[] | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.getEventAttendeesSummary(eventId);
        if (!cancelled) {
          setAttendees(data.attendees);
          setCount(data.totalCount);
        }
      } catch (err) {
        if (!cancelled) setAttendees([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) {
    return (
      <div className="whos-going">
        <div className="whos-going-avatars">
          {[1, 2, 3].map((i) => (
            <div key={i} className="whos-going-avatar skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (!attendees || count === 0) return null;

  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  };

  const displayed = attendees.slice(0, 6);
  const moreCount = Math.max(0, count - 6);

  return (
    <div className="whos-going">
      <div className="whos-going-avatars">
        {displayed.map((a, i) => (
          <div
            key={i}
            className="whos-going-avatar"
            title={a.name || "Anonymous"}
          >
            {getInitials(a.name)}
          </div>
        ))}
        {moreCount > 0 && (
          <div className="whos-going-avatar more">+{moreCount}</div>
        )}
      </div>
      <p className="whos-going-text">
        <b>{count}</b> {count === 1 ? "person is" : "people are"} going
      </p>
    </div>
  );
}
