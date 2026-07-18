import type { CheckoutFormField } from "../api";

// Renders an event's organizer-configured extra booking-form fields (see
// EventWorkspace.tsx's CheckoutFormBuilder) below the tier/qty picker on
// EventDetail.tsx/Checkout.tsx. `values` is keyed by field.id — checkbox
// fields hold a boolean, everything else a string. Shared between the free
// RSVP and paid checkout flows so the two don't drift.
export default function CheckoutFormFields({
  fields, values, onChange,
}: {
  fields: CheckoutFormField[];
  values: Record<string, string | boolean>;
  onChange: (id: string, value: string | boolean) => void;
}) {
  if (!fields.length) return null;
  return (
    <div className="checkout-form-fields" style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
      {fields.map((f) => (
        <div className="field" key={f.id}>
          <label>{f.label}{f.required && " *"}</label>
          {f.type === "checkbox" ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
              <input type="checkbox" checked={!!values[f.id]} onChange={(e) => onChange(f.id, e.target.checked)} />
              {f.label}
            </label>
          ) : f.type === "dropdown" ? (
            <select value={(values[f.id] as string) || ""} onChange={(e) => onChange(f.id, e.target.value)}>
              <option value="" disabled>Select…</option>
              {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
              value={(values[f.id] as string) || ""}
              onChange={(e) => onChange(f.id, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
