import { Link } from "react-router-dom";
import type { Account } from "../store";

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function UserAvatar({ account }: { account: Account | null }) {
  if (!account) return null;

  return (
    <Link to="/you" className="page-top-bar-avatar">
      {account.picture ? (
        <img src={account.picture} alt="" />
      ) : (
        <span>{initialsOf(account.name)}</span>
      )}
    </Link>
  );
}
