import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Orders live in the "Requests & orders" list (F-05). */
export default function ClientOrdersIndex() {
  redirect("/app/requests");
}
