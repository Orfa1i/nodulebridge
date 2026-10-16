import type { Metadata } from "next";
import { PassportPrint } from "@/components/passport/PassportPrint";

export const metadata: Metadata = { title: "Follow-up passport · print" };

export default function PassportPrintPage() {
  return <PassportPrint />;
}
