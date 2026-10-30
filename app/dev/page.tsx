import type { Metadata } from "next";
import { Lab } from "@/components/lab/Lab";

export const metadata: Metadata = { title: "Retell · Flow stage lab" };

export default function Dev() {
  return <Lab />;
}
