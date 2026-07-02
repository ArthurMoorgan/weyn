import { useNavigate } from "react-router-dom";

export default function CheckoutCancel() {
  const nav = useNavigate();

  return (
    <div className="detail">
      <div className="sheet glass" style={{ marginTop: 100, textAlign: "center" }}>
        <div className="ic"><i className="ti ti-x" /></div>
        <h2>Checkout cancelled</h2>
        <p>No payment was made — your ticket wasn't reserved.</p>
        <button className="btn" style={{ maxWidth: 220, margin: "20px auto 0" }} onClick={() => nav(-1)}>
          Back
        </button>
      </div>
    </div>
  );
}
